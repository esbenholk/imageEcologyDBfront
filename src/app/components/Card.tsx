"use client";

import { ImageCardProps } from "@/components/imageCardProps";
import { useEffect, useState } from "react";

export const Card: React.FC<{ data: ImageCardProps }> = ({ data }) => {
  const [parentIds, setParentIds] = useState<string[]>([]);
  const [limitedTags, setLimitedTags] = useState<string[]>([]);

  useEffect(() => {
    // parse parentIds if JSON string
    if (data.parentIds) {
      if (typeof data.parentIds === "string" && data.parentIds !== "") {
        try {
          const parsed = JSON.parse(data.parentIds);
          if (Array.isArray(parsed)) {
            setParentIds(parsed);
          } else {
            setParentIds([]);
          }
        } catch {
          // not valid JSON, maybe a comma list
          setParentIds(
            data.parentIds
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean)
          );
        }
      } else if (Array.isArray(data.parentIds)) {
        setParentIds(data.parentIds);
      } else {
        setParentIds([]);
      }
    } else {
      setParentIds([]);
    }

    // cap tags for safety
    const _limitedTags = (data.tags || []).slice(0, 20);
    setLimitedTags(_limitedTags);

    console.log(data);
  }, [data]);

  return (
    <div className="image-card">
      {/* IMAGE */}
      <div className="image-wrapper">
        <img src={data.url} alt={data.description || data.aiTitle || "image"} />
      </div>

      <div className="info">
        <div>
          <div className="flexRow">
            <p className="label">user input:</p>
            <p className="titleCont">
              {data.title === "_" ? "original image" : data.title}
            </p>
          </div>

          {/* Community */}
          {data.community && (
            <div className="community flexRow">
              <p className="label">community:</p>
              <p className="titleCont">{data.community}</p>
            </div>
          )}
        </div>

        <div>
          {data.ai_so_me_type && (
            <div className="meta flexRow">
              <p>
                <strong>social type:</strong>
              </p>
              <p className="titleCont">{data.ai_so_me_type}</p>
            </div>
          )}
          {data.aiTrend && (
            <div className="meta flexRow">
              <p>
                <strong>trend:</strong>
              </p>{" "}
              <p> {data.aiTrend}</p>
            </div>
          )}
        </div>

        <div>
          <div className="flexRow">
            {data.aiTitle && (
              <p className="title">
                <strong>{data.aiTitle}</strong>
              </p>
            )}
          </div>

          {/* Description */}
          {data.description &&
            data.description.toLowerCase() !== "untitled" && (
              <div className="description flexRow">
                <p className="label">description:</p>
                <p className="titleCont">{data.description}</p>
              </div>
            )}

          {data.aiVibe && (
            <div className="meta flexRow">
              <p>
                <strong>vibe:</strong>
              </p>
              <p className="titleCont">{data.aiVibe}</p>
            </div>
          )}
          {data.aiObjects && (
            <div className="meta flexRow">
              <p>
                <strong>objects:</strong>
              </p>
              <p className="titleCont">{data.aiObjects}</p>
            </div>
          )}
          {data.aiStyle && (
            <div className="meta flexRow">
              <p>style:</p>
              <p className="titleCont">{data.aiStyle}</p>
            </div>
          )}
        </div>

        {/* User input section */}
        {parentIds.length > 0 ? (
          <div className="input">
            <p className="label">parents:</p>
            <div className="parent-previews">
              {parentIds.map((src, index) => (
                <img
                  key={index}
                  src={src}
                  alt={`parent-${index}`}
                  className="parent-thumb"
                />
              ))}
            </div>
          </div>
        ) : null}

        {/* Tags */}
        {limitedTags && limitedTags.length > 0 && (
          <div className="tags">
            {limitedTags.map((tag, i) => (
              <span key={i} className="tag">
                #{tag}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
