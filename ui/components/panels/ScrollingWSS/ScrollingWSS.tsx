"use client";
import { motion } from "framer-motion";
import { useEffect, useState, useRef } from "react";
import { noticeToText } from "@/helpers/textHelper";

const ScrollingWSS = () => {
  const [messageLines, setMessageLines] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);
  const resolverRef = useRef(Promise.resolve());
  // const lineHeightRef = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);

  // const measureLineHeight = () => {
  //   if (containerRef.current) {
  //     const probe = document.createElement("span");
  //     probe.textContent = "M";
  //     probe.style.position = "absolute";
  //     probe.style.visibility = "hidden";
  //     containerRef.current.appendChild(probe);
  //     lineHeightRef.current = probe.offsetHeight;
  //     containerRef.current.removeChild(probe);
  //   }
  // };

  const addText = (text: string) => {
    resolverRef.current = resolverRef.current.then(() => _addText(text));
  };

  const _addText = async (text: string) => {
    // console.log("Adding text:", text);

    const nChars = text.length;
    const delayTime = 0;

    setMessageLines((prev) => {
      const newLines = [""];
      return [...newLines, ...prev];
    });

    let charIndex = 0;
    while (charIndex < text.length) {
      await new Promise((resolve) => setTimeout(resolve, delayTime));

      setMessageLines((prev) => {
        const newLines = [...prev];
        newLines[0] = text.substring(0, charIndex + 1);
        return newLines;
      });

      charIndex++;
    }

    setMessageLines((prev) => {
      if (prev.length > 20) {
        return prev.slice(0, 20);
      }
      return prev;
    });
  };

  useEffect(() => {
    // measureLineHeight();
    const socket = new WebSocket("wss://wss.nori.it.com/");

    socket.addEventListener("open", () => {
      console.log("Connected to WebSocket");
      setConnected(true);

      socket.send(
        JSON.stringify({ method: "subscribe", topic: "notices.system.*" })
      );
      socket.send(
        JSON.stringify({ method: "subscribe", topic: "notices.transition.*" })
      );
    });

    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      const noticeStrings = noticeToText(msg);

      if (noticeStrings === null) return;
      else if (Array.isArray(noticeStrings)) {
        noticeStrings.forEach((subMsg) => addText(subMsg));
      } else {
        addText(noticeStrings);
      }
    });

    return () => {
      socket.close();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      data-testid="scrolling-wss-container"
      className="relative w-full h-full overflow-hidden left-4 text-lightGreen"
      style={{
        maskImage:
          "linear-gradient(to right, transparent 5%, white 30%, white 100%)",
        transform: "perspective(400px) rotateY(10deg)",
        transformStyle: "preserve-3d",
        color: "--var(lightGreen)",
      }}
    >
      {messageLines.map((line, idx) => (
        <motion.div
          key={idx}
          className="top-1/2 left-0 text-2xl whitespace-nowrap"
          initial={{ x: "-300%" }}
          animate={{ x: "100%" }}
          transition={{
            duration: 15,
            repeat: Infinity,
            ease: "linear",
            delay: idx * 0.1,
          }}
        >
          <div>{line}</div>
        </motion.div>
      ))}
    </div>
  );
};

export default ScrollingWSS;
