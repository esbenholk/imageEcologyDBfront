"use client";
import { useEffect, useState } from "react";
import "../index.css"; // Import global CSS
import { Upload } from "../components/Upload";

export default function Home() {
  // const colors = ['#632bf3', '#f122c8', '#f16022', '#9ef344', '#44d3f3'];
  const [windowHeight, setWindowHeight] = useState<number>(0);
  useEffect(() => {
    const handleResize = () => {
      setWindowHeight(window.innerHeight);
    };
    window.addEventListener("resize", handleResize);
    console.log("renders page");
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <main className="container">
      <Upload />
    </main>
  );
}
