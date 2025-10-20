import React, { useEffect, useState, useRef } from "react";
import Gallery from "./Gallery";
import type { ImageCardProps } from "./imageCardProps";
import { io, Socket } from "socket.io-client";

export function Upload() {
  // ===== State
  const [image, setImage] = useState<string | null>(null);
  const [text, setText] = useState("");
  const textArea = useRef<HTMLTextAreaElement>(null);

  const [loading, setLoading] = useState(false);
  const [uploading, setUploadLoading] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showGallery, setShowGallery] = useState(false);

  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [remixedPrompt, setRemixedPrompt] = useState("");

  // tags
  const [words, setWords] = useState<string[]>([]);
  const [currentWord, setCurrentWord] = useState<string>("");

  // classification
  const [classes, setClasses] = useState<string[]>([]);
  const [currentClass, setCurrentClass] = useState<string>("");

  // communities
  const [community, setCommunity] = useState<string>("");
  const [availableCommunities, setAvailableCommunities] = useState<string[]>(
    []
  );

  // data + pagination
  const [news, setNews] = useState<ImageCardProps[]>([]);
  const [loadIndex, setLoadIndex] = useState<number>(0);
  const [isFetchingRecent, setIsFetchingRecent] = useState(false);

  // misc
  const [error, setError] = useState<string>("");
  const [succes, setSucces] = useState(false);

  // ===== Refs to handle dev strict-mode + re-entrancy
  const didLoadRef = useRef(false);
  const inFlightRef = useRef(false);

  // ===== Socket (create/cleanup per mount)
  const socketRef = useRef<Socket | null>(null);
  useEffect(() => {
    // create user id once per session
    let storedUserId = sessionStorage.getItem("userId");
    if (!storedUserId) {
      storedUserId = Math.random().toString(36).substring(7);
      sessionStorage.setItem("userId", storedUserId);
    }

    const s = io("https://dancingwai-11f115b681e2.herokuapp.com", {
      autoConnect: false,
    });
    socketRef.current = s;
    s.connect();

    const onReceive = (message: any) => console.log("gets io message", message);
    const onConnect = () => console.log("connects");
    const onHello = (msg: any) => console.log("hello", msg);

    s.on("receiveMessage", onReceive);
    s.on("connect", onConnect);
    s.on("hello", onHello);

    return () => {
      s.off("receiveMessage", onReceive);
      s.off("connect", onConnect);
      s.off("hello", onHello);
      s.disconnect();
      socketRef.current = null;
    };
  }, []);

  // ===== Initial load (strict-mode safe)
  useEffect(() => {
    if (didLoadRef.current) return; // prevents double-run in React 18 dev
    didLoadRef.current = true;
    void fetchRecentImages();
  }, []);

  // ===== Fetch images (guarded)
  const fetchRecentImages = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    const ac = new AbortController();
    setIsFetchingRecent(true);
    setError("");

    try {
      const res = await fetch(
        `/api/cloudinary/recent?skip=${loadIndex}&limit=10`,
        { signal: ac.signal, cache: "no-store" }
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      console.log("has data", data);

      if (Array.isArray(data) && data.length) {
        const mapped: ImageCardProps[] = data.map((data: any) => ({
          title: data.title,
          url: data.url,
          tags: data.tags,
          aiCaption: data.caption,
          description: data.alt || "Untitled",
          aiTitle: data.ai_title,
          aiVibe: data.ai_vibe,
          aiObjects: data.ai_objects,
          aiFeeling: data.ai_feeling,
          id: data.id,
          community: data.community,
          parentIds: data.parentIds,
          ai_so_me_type: data.aiSoMeType,
          aiStyle: data.aiStyle,
          aiTrend: data.aiTrend,
        }));

        setNews((prev) => [...prev, ...mapped]);
        setLoadIndex((prev) => prev + 10);
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        setError(
          e instanceof Error ? e.message : "Failed to fetch recent images"
        );
      }
    } finally {
      setIsFetchingRecent(false);
      inFlightRef.current = false;
    }

    return () => ac.abort();
  };

  // ===== Derive available communities from news (lowercased + unique) + presets
  useEffect(() => {
    const uniqueFromNews = Array.from(
      new Set(
        news
          .map((n) => n.community?.toLowerCase?.().trim())
          .filter(Boolean) as string[]
      )
    );

    const presets = ["brainrot", "thirsttrap", "lifestyle"];
    const merged = Array.from(new Set([...uniqueFromNews, ...presets]));

    setAvailableCommunities(merged);
  }, [news]);

  // ===== UX helpers
  const showSucces = (duration = 1500) => {
    setSucces(true);
    setTimeout(() => setSucces(false), duration);
  };

  // ----- Tag input handlers
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === " " ||
      e.keyCode === 32 ||
      e.keyCode === 0 ||
      e.key === "Enter"
    ) {
      e.preventDefault();
      if (currentWord.trim()) {
        setWords((prev) => [...prev, currentWord.trim()]);
        setCurrentWord("");
      }
    }
  };
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.endsWith(" ") || value.endsWith("\n")) {
      if (currentWord.trim()) {
        setWords((prev) => [...prev, currentWord.trim()]);
        setCurrentWord("");
      }
    } else {
      setCurrentWord(value);
    }
  };
  const handleRemoveWord = (index: number) => {
    setWords((prev) => prev.filter((_, i) => i !== index));
  };
  const joinWithComma = (arr: string[]) => arr.join(", ");

  // ----- Classification handlers
  const handleClassKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      e.key === " " ||
      e.keyCode === 32 ||
      e.keyCode === 0 ||
      e.key === "Enter"
    ) {
      e.preventDefault();
      if (currentClass.trim()) {
        setClasses((prev) => [...prev, currentClass.trim()]);
        setCurrentClass("");
      }
    }
  };
  const handleClassInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    if (value.endsWith(" ") || value.endsWith("\n")) {
      if (currentClass.trim()) {
        setClasses((prev) => [...prev, currentClass.trim()]);
        setCurrentClass("");
      }
    } else {
      setCurrentClass(value);
    }
  };
  const handleRemoveClass = (index: number) => {
    setClasses((prev) => prev.filter((_, i) => i !== index));
  };

  // ===== Generation + Upload
  const generateImage = async () => {
    setLoading(true);
    const promptText = textArea.current?.value ?? "";

    if (promptText !== "" || words.length > 0) {
      try {
        const response = await fetch(
          `/api/generateImage?prompt=${encodeURIComponent(
            promptText || "utopias"
          )}&remixed=yes&adjectives=${encodeURIComponent(
            joinWithComma(words) || ""
          )}`
        );
        const data = await response.json();

        if (!response.ok) throw new Error(data.error || "Generation failed");
        setImage(null);
        setGeneratedImage(data.imageUrl);
        setRemixedPrompt(data.remixedPrompt);
        setText(data.prompt);
      } catch {
        setError("that didnt work");
      } finally {
        setLoading(false);
      }
    } else {
      setError("Alchymist, you need to describe your utopia fragment");
      setLoading(false);
    }
  };

  const upLoadImage = async (_image: string) => {
    try {
      setUploadLoading(true);
      const promptText = textArea.current?.value ?? "";

      if (_image != null) {
        const tags = joinWithComma(words);
        const response = await fetch(`/api/cloudinary/upload`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            imageUrl: _image,
            title: promptText || "_",
            tags,
            classes: joinWithComma(classes),
            community,
          }),
        });

        const data = await response.json();
        if (!response.ok) {
          setError("this image is bad");
          throw new Error(data.error || "Upload failed");
        } else {
          const card: ImageCardProps = {
            title: data.title,
            url: data.url,
            tags: data.tags,
            aiCaption: data.caption,
            description: data.alt || "Untitled",
            aiTitle: data.ai_title,
            aiVibe: data.ai_vibe,
            aiObjects: data.ai_objects,
            aiFeeling: data.ai_feeling,
            id: data.id,
            community: data.community,
            parentIds: data.parentIds,
            ai_so_me_type: data.aiSoMeType,
            aiStyle: data.aiStyle,
            aiTrend: data.aiTrend,
          };

          shareImageToSocket(card);
          poorImageIntoCouldron(card);
        }
      } else {
        setError("Alchymist, you need to invent a scene");
      }
    } catch {
      setError("image is bad");
    } finally {
      // reset UI
      setLoading(false);
      setUploadLoading(false);
      setShowUpload(false);
      setImage(null);
      setText("");
      setCommunity("");
      setClasses([]);
      setWords([]);
      setGeneratedImage(null);
    }
  };

  // ===== File & socket helpers
  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => setImage(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const shareImageToSocket = (_image: ImageCardProps) => {
    socketRef.current?.emit("hello", _image);
  };

  const poorImageIntoCouldron = (_image: ImageCardProps) => {
    setNews((prev) => [_image, ...prev]); // immutable
    showSucces();
    setImage(null);
    setGeneratedImage(null);
    setShowGallery(false);
    setLoading(false);
    setUploadLoading(false);
    setShowUpload(false);
    setText("");
    setWords([]);
    setGeneratedImage(null);
  };

  // ===== Submit
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    if (image) {
      await upLoadImage(image);
    } else if (generatedImage) {
      await upLoadImage(generatedImage);
    } else {
      setLoading(false);
      // no image provided
    }
  };

  // ===== Render
  return (
    <div className="mainContainer">
      <form
        onSubmit={handleSubmit}
        className={uploading ? "uploading uploader" : "uploader"}
      >
        <p>contribute to the image ecology simulation</p>

        <div className="uploaderButtons">
          <label
            htmlFor="image-upload"
            className={
              !loading
                ? "imgUploadBtn active super-default"
                : "imgUploadBtn passive super-default"
            }
          >
            {image ? "upload another image" : "upload new image"}
          </label>
          <input
            id="image-upload"
            type="file"
            accept="image/*"
            onChange={handleImageChange}
            className="sr-only"
          />
        </div>

        <div className="imageResult">
          {image ? (
            <>
              <button
                className="closebtn"
                type="button"
                onClick={() => setImage(null)}
              >
                X
              </button>
              <img src={image} alt="Preview" className="subImage" />
            </>
          ) : null}
          {uploading ? <div className="loaderAnim"></div> : null}
        </div>

        <div className={error ? "textinputs error" : "textinputs"}>
          <p>image description</p>
          <textarea
            ref={textArea}
            id="text"
            value={text}
            autoCorrect="false"
            onChange={(e) => setText(e.target.value)}
            placeholder="describe the image"
          />
        </div>

        <div className={error ? "wordinputs error" : "wordinputs"}>
          <p>image tagging</p>
          <input
            type="text"
            value={currentWord}
            autoCorrect="false"
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            className="mt-2 p-2 border rounded-md"
            placeholder="optional: tag the image"
          />
          <div className="flex-row-wrap adjButtons">
            {words.map((word, index) => (
              <button
                key={`${word}-${index}`}
                type="button"
                onClick={() => handleRemoveWord(index)}
                className="adjBtn"
              >
                {word} ✖
              </button>
            ))}
          </div>
        </div>

        <div className={error ? "textinputs error" : "textinputs"}>
          <p>image classification</p>
          <input
            type="text"
            value={currentClass}
            autoCorrect="false"
            onChange={handleClassInputChange}
            onKeyDown={handleClassKeyDown}
            className="mt-2 p-2 border rounded-md"
            placeholder="optional: image population/type"
          />
          <div className="flex-row-wrap adjButtons">
            {classes.map((cls, index) => (
              <button
                key={`${cls}-${index}`}
                onClick={() => handleRemoveClass(index)}
                className="adjBtn"
                type="button"
              >
                {cls} ✖
              </button>
            ))}
          </div>
        </div>

        <div className={error ? "textinputs error" : "textinputs"}>
          <p>community</p>

          {/* Existing communities as selectable buttons */}
          <div className="flex-row-wrap adjButtons">
            {availableCommunities.map((comm) => (
              <button
                key={comm}
                type="button"
                onClick={() => setCommunity(comm)}
                className={`adjBtn ${community === comm ? "active" : ""}`}
              >
                {comm}
              </button>
            ))}
          </div>

          {/* Manual input for custom community */}
          <input
            type="text"
            value={community}
            onChange={(e) => setCommunity(e.target.value.toLowerCase())}
            placeholder="or write your own community"
            className="mt-2 p-2 border rounded-md"
            autoCorrect="false"
          />
        </div>

        <div className="uploaderButtons right">
          <button
            type="submit"
            className={
              loading
                ? "passive"
                : generatedImage
                ? "active"
                : image
                ? "active"
                : "passive"
            }
          >
            {loading ? "loading content" : <>upload</>}
          </button>
        </div>

        {succes && (
          <div className="succes">
            <p>upload complete</p>
          </div>
        )}
        {error && error != "" && (
          <div
            className="succes error"
            onClick={() => {
              setError("");
            }}
          >
            <p>{error}</p>
          </div>
        )}
      </form>

      <div className="gallery">
        <Gallery
          news={news}
          poorRemixedImageIntoCouldron={poorImageIntoCouldron}
          shareImageToSocket={shareImageToSocket}
        />
        {!isFetchingRecent && (
          <div style={{ marginTop: 16 }}>
            <button
              type="button"
              className="adjBtn"
              onClick={() => fetchRecentImages()}
            >
              load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
