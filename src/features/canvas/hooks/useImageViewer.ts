import { useCallback, useState } from 'react';

/**
 * 图片查看器 Hook
 * 职责：管理图片查看器的状态
 */
export const useImageViewer = () => {
  const [isOpen, setIsOpen] = useState(false);
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [imageList, setImageList] = useState<string[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const openViewer = useCallback((imageUrl: string, images: string[] = []) => {
    setCurrentImage(imageUrl);
    setImageList(images.length > 0 ? images : [imageUrl]);
    const index = images.indexOf(imageUrl);
    setCurrentIndex(index >= 0 ? index : 0);
    setIsOpen(true);
  }, []);

  const closeViewer = useCallback(() => {
    setIsOpen(false);
  }, []);

  const nextImage = useCallback(() => {
    if (currentIndex < imageList.length - 1) {
      const newIndex = currentIndex + 1;
      setCurrentIndex(newIndex);
      setCurrentImage(imageList[newIndex]);
    }
  }, [currentIndex, imageList]);

  const previousImage = useCallback(() => {
    if (currentIndex > 0) {
      const newIndex = currentIndex - 1;
      setCurrentIndex(newIndex);
      setCurrentImage(imageList[newIndex]);
    }
  }, [currentIndex, imageList]);

  const canGoNext = currentIndex < imageList.length - 1;
  const canGoPrevious = currentIndex > 0;

  return {
    isOpen,
    currentImage,
    imageList,
    currentIndex,
    canGoNext,
    canGoPrevious,
    openViewer,
    closeViewer,
    nextImage,
    previousImage,
  };
};
