"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
const ScrollingWSS = () => {
  const [messages, setMessages] = useState<string[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
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

      setMessages((prev) => {
        if (prev.length < 20) {
          return [...prev, JSON.stringify(msg)];
        } else {
          const newArray = [...prev];
          newArray.shift();
          return [...newArray, JSON.stringify(msg)];
        }
      });
    });

    return () => {
      socket.close();
    };
  }, []);

  return (
    <div
      className="relative w-full h-full overflow-hidden left-4 text-lightGreen"
      style={{
        maskImage:
          "linear-gradient(to right, transparent 5%, white 30%, white 100%)",
        transform: "perspective(400px) rotateY(10deg)",
        transformStyle: "preserve-3d",
        color: "--var(lightGreen)",
      }}
    >
      {messages.map((msg, idx) => (
        <motion.div
          key={idx}
          className="top-1/2 left-0 text-2xl whitespace-nowrap"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
        >
          <div>{msg}</div>
        </motion.div>
      ))}
    </div>
  );
};

export default ScrollingWSS;
