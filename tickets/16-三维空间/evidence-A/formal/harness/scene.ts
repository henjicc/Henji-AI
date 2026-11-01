import * as THREE from 'three/webgpu'
export default {
 name: '三维空间受管样片', width: 1920, height: 1080, durationSeconds: 5,
 createThree() {
  const scene = new THREE.Scene()
  const mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(.15,1),new THREE.MeshStandardNodeMaterial({color:0xdedede,roughness:.38,metalness:.05,flatShading:true}))
  scene.add(mesh,new THREE.HemisphereLight(0xffffff,0x2a2a2a,1.1))
  const key=new THREE.DirectionalLight(0xffffff,2.4);key.position.set(1.2,1.6,2);scene.add(key)
  return { scene, update(_parameters,_assets,info) {
   const z=Math.min(.62,Math.max(-.3,.35+(info.space.sampleTime-5.6)*2.25))
   mesh.position.set(.42,.2,z);mesh.rotation.set(info.time*.6,info.time*1.1,0)
  } }
 }
}
