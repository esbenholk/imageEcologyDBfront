// Gallery.tsx
"use client";

import React, { useMemo, useState } from "react";
import { Card } from "../app/components/Card";
import { ImageCardProps } from "./imageCardProps";

export default function Gallery({
  news,
  communityCategories,
  selectedImages,
  onToggleSelection,
  onOpenRemixer,
}: {
  news: ImageCardProps[];
  communityCategories: string[];
  selectedImages: ImageCardProps[];
  onToggleSelection: (image: ImageCardProps) => void;
  onOpenRemixer: () => void;
}) {
  const [selectedCommunity, setSelectedCommunity] = useState<string>("All");

  const categories = useMemo(() => {
    const base = Array.isArray(communityCategories) ? communityCategories : [];
    const unique = Array.from(new Set(base.filter(Boolean)));
    return ["All", ...unique];
  }, [communityCategories]);

  const filteredNews = useMemo(() => {
    if (!news?.length) return [];
    if (selectedCommunity === "All") return news;
    return news.filter(
      (n) =>
        (n.community || "").toLowerCase() === selectedCommunity.toLowerCase()
    );
  }, [news, selectedCommunity]);

  return (
    <>
      {categories.length > 0 && (
        <div className="flexRow catChoice">
          {categories.map((comm) => (
            <button
              key={comm}
              type="button"
              onClick={() => setSelectedCommunity(comm)}
              aria-pressed={selectedCommunity === comm}
              className={`adjBtn ${selectedCommunity === comm ? "active" : ""}`}
              title={comm === "All" ? `Show all images` : `Show ${comm}`}
            >
              {comm}
            </button>
          ))}
        </div>
      )}

      {filteredNews.length > 0 && (
        <>
          {filteredNews.map((image) => {
            const isSelected = selectedImages.some(
              (img) => img.url === image.url
            );
            return (
              <div
                key={image.id ?? image.url}
                className={`Card ${isSelected ? "selected" : ""}`}
              >
                <Card data={image} />
                <button
                  onClick={() => onToggleSelection(image)}
                  className="mt-2 flex items-center gap-1"
                >
                  {!isSelected ? "remix" : "remove from remix"}
                </button>
              </div>
            );
          })}
        </>
      )}
    </>
  );
}
