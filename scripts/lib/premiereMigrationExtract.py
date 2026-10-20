"""Read-only Premiere object-graph extraction for a controlled project migration.

Uses Python's XML/gzip readers rather than a second timeline model or an
undeclared transitive npm dependency. Only sequences reachable from the chosen
UUID are exported; same-name remix sequences and project backups stay distinct.
This is developer migration tooling, not an application-side script interface.
"""
import argparse
import base64
import gzip
import hashlib
import json
from pathlib import Path
import struct
import sys
import xml.etree.ElementTree as ET

TICKS = 254016000000


class ProjectGraph:
    def __init__(self, data):
        self.root = ET.fromstring(gzip.decompress(data) if data[:2] == b"\x1f\x8b" else data)
        if self.root.tag != "PremiereData":
            raise ValueError("Expected a PremiereData project")
        # ObjectID is scoped to the top-level graph. Nested view-state IDs reuse
        # numbers and must never overwrite the media/timeline definitions.
        self.ids = {e.get("ObjectID"): e for e in self.root if e.get("ObjectID")}
        self.uids = {e.get("ObjectUID"): e for e in self.root if e.get("ObjectUID")}

    def ref(self, element):
        if element is None:
            raise ValueError("Missing object reference")
        if element.get("ObjectRef"):
            return self.ids[element.get("ObjectRef")]
        return self.uids[element.get("ObjectURef")]

    def effects(self, owner):
        link = owner.find("ComponentOwner/Components")
        if link is None:
            return []
        chain = self.ref(link)
        result = []
        for ref in chain.findall("ComponentChain/Components/Component"):
            effect = self.ref(ref)
            result.append({
                "id": effect.get("ObjectID"), "type": effect.tag,
                "matchName": effect.findtext("MatchName") or effect.findtext("FilterMatchName") or effect.tag,
                "name": effect.findtext(".//Component/DisplayName") or effect.tag,
                "xml": ET.tostring(effect, encoding="unicode"),
                "parameters": [{"id": self.ref(p).get("ObjectID"), **{c.tag: c.text for c in self.ref(p)}}
                               for p in effect.findall(".//Component/Params/Param")],
            })
        return result

    def caption(self, item):
        texts = []
        for block_ref in item.findall("BlockVector/BlockVectorItem"):
            encoded = self.ref(block_ref).findtext("FormattedTextData")
            if not encoded:
                raise ValueError("Caption block has no FormattedTextData")
            data = base64.b64decode(encoded)
            # Premiere stores FlatBuffer strings as uint32 length + UTF-8 + NUL.
            # Keep the source block too: typography is not inferred from bytes.
            candidates = []
            for offset in range(0, len(data) - 4, 4):
                size = struct.unpack_from("<I", data, offset)[0]
                end = offset + 4 + size
                if not 0 < size <= len(data) - offset - 5 or data[end] != 0:
                    continue
                try:
                    value = data[offset + 4:end].decode("utf-8")
                except UnicodeDecodeError:
                    continue
                if any(ord(c) < 32 and c not in "\n\r\t" for c in value):
                    continue
                if any("\u3400" <= c <= "\u9fff" for c in value):
                    candidates.append(value)
            # This controlled migration targets Chinese captions. Ambiguity is
            # a hard failure, not a guess that silently substitutes stale SRT.
            unique = list(dict.fromkeys(candidates))
            if len(unique) != 1:
                raise ValueError(f"Caption {item.get('ObjectID')} has {len(unique)} text candidates")
            texts.append(unique[0])
        return "\n".join(texts)

    def clip(self, item):
        core = item.find(".//ClipTrackItem")
        if core is None:
            raise ValueError(f"Unsupported track item: {item.tag}")
        track_item = core.find("TrackItem")
        result = {"id": item.get("ObjectID"), "type": item.tag,
                  "start": track_item.findtext("Start", "0"), "end": track_item.findtext("End"),
                  "muted": item.findtext(".//IsMuted", "false") == "true",
                  "effects": self.effects(core)}
        if item.tag == "CaptionDataClipTrackItem":
            result["text"] = self.caption(item)
            return result
        sub = self.ref(core.find("SubClip"))
        source_clip = self.ref(sub.find("Clip"))
        clip = source_clip.find(".//Clip")
        if clip is None:
            raise ValueError(f"Missing Clip in {source_clip.tag}")
        source = self.ref(clip.find("Source"))
        result.update({"name": sub.findtext("Name"), "sourceType": source.tag,
                       "in": clip.findtext("InPoint", "0"), "out": clip.findtext("OutPoint"),
                       "speed": clip.findtext("PlaybackSpeed", "1"),
                       "reverse": clip.findtext("Reverse", "false") == "true",
                       "preservePitch": clip.findtext("MaintainAudioPitch", "false") == "true",
                       "headTransition": core.find("HeadTransition").get("ObjectRef") if core.find("HeadTransition") is not None else None,
                       "tailTransition": core.find("TailTransition").get("ObjectRef") if core.find("TailTransition") is not None else None})
        sequence = source.find("SequenceSource/Sequence")
        if sequence is not None:
            result["sequenceId"] = sequence.get("ObjectURef")
        else:
            media = self.ref(source.find("MediaSource/Media"))
            result["mediaId"] = media.get("ObjectUID")
        return result

    def sequence(self, uid):
        seq = self.uids[uid]
        if seq.tag != "Sequence":
            raise ValueError(f"Not a sequence: {uid}")
        result = {"id": uid, "name": seq.findtext("Name"), "tracks": [], "markers": []}
        for group_ref in seq.findall("TrackGroups/TrackGroup/Second"):
            group = self.ref(group_ref)
            if group.tag == "VideoTrackGroup":
                result.update({"frameRect": group.findtext("FrameRect"), "frameTicks": group.findtext("TrackGroup/FrameRate"),
                               "pixelAspectRatio": group.findtext("PixelAspectRatio", "1,1")})
            for track_ref in group.findall("TrackGroup/Tracks/Track"):
                track = self.ref(track_ref)
                ct = track.find(".//ClipTrack")
                if ct is None:
                    raise ValueError(f"Unsupported track: {track.tag}")
                base = ct.find("Track")
                tracks = result["tracks"]
                kind = "video" if group.tag == "VideoTrackGroup" else "audio" if group.tag == "AudioTrackGroup" else "caption"
                tracks.append({"id": track.get("ObjectUID"), "kind": kind,
                               "index": int(base.findtext("Index", "0")), "name": base.findtext("Name"),
                               "xml": ET.tostring(base, encoding="unicode"), "effects": self.effects(track.find("AudioTrack")) if track.find("AudioTrack") is not None else [],
                               "clips": [self.clip(self.ref(ref)) for ref in ct.findall("ClipItems/TrackItems/TrackItem")],
                               "transitions": []})
                if kind == "caption":
                    tracks[-1]["captionStyle"] = {
                        "template": track.findtext("CaptionDataTemplateStyle"),
                        "metadata": json.loads(track.findtext("Metadata", "{}")),
                    }
                for ref in ct.findall("TransitionItems/TrackItems/TrackItem"):
                    transition = self.ref(ref).find("TransitionTrackItem")
                    tracks[-1]["transitions"].append({"id": ref.get("ObjectRef"),
                        "start": transition.findtext("TrackItem/Start", "0"), "end": transition.findtext("TrackItem/End"),
                        "alignment": transition.findtext("Alignment", "0"),
                        "matchName": transition.findtext("MatchName"), "xml": ET.tostring(transition, encoding="unicode")})
        marker_ref = seq.find("MarkerOwner/Markers")
        if marker_ref is not None:
            for ref in self.ref(marker_ref).findall("Markers/Marker/Second"):
                result["markers"].append(json.loads(self.ref(ref).findtext("DVAMarker"))["DVAMarker"])
        return result

    def extract(self, main_id):
        sequences, pending = {}, [main_id]
        while pending:
            uid = pending.pop()
            if uid in sequences:
                continue
            seq = sequences[uid] = self.sequence(uid)
            pending.extend(clip["sequenceId"] for t in seq["tracks"] for clip in t["clips"] if "sequenceId" in clip)
        media = {}
        for seq in sequences.values():
            for track in seq["tracks"]:
                for clip in track["clips"]:
                    mid = clip.get("mediaId")
                    if not mid or mid in media:
                        continue
                    source = self.uids[mid]
                    media[mid] = {"id": mid, "name": source.findtext("Title"),
                                  "path": source.findtext("ActualMediaFilePath") or source.findtext("FilePath"),
                                  "relativePath": source.findtext("RelativePath"), "streams": {}}
                    for field in ["VideoStream", "AudioStream"]:
                        ref = source.find(field)
                        if ref is not None:
                            stream = self.ref(ref)
                            media[mid]["streams"][field] = {c.tag: c.text for c in stream if c.tag in ["FrameRate", "Duration", "IsStill", "FrameRect", "SampleRate", "Channels"]}
        return {"ticksPerSecond": str(TICKS), "mainSequenceId": main_id, "sequences": list(sequences.values()), "media": list(media.values())}


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("project")
    parser.add_argument("sequence_uuid")
    parser.add_argument("output")
    args = parser.parse_args()
    data = Path(args.project).read_bytes()
    output = ProjectGraph(data).extract(args.sequence_uuid)
    output["source"] = {"path": str(Path(args.project).resolve()), "sha256": hashlib.sha256(data).hexdigest()}
    Path(args.output).write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"sequences": len(output["sequences"]), "media": len(output["media"]), "clips": sum(len(t["clips"]) for s in output["sequences"] for t in s["tracks"])}, ensure_ascii=False))
