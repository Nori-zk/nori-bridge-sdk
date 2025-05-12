import { useEffect, useState } from "react";
import { motion } from "framer-motion";

const ScrollingBridge = () => {
  const [svgContent, setSvgContent] = useState("");

  useEffect(() => {
    fetch("/assets/All-Bridge.svg")
      .then((response) => response.text())
      .then((text) => {
        const modifiedSVG = text
          .replace(/fill="black"/g, 'fill="lightGreen"')
          .replace(/stroke="black"/g, 'stroke="lightGreen"');
        setSvgContent(modifiedSVG);
      });
  }, []);

  return (
    <div
      data-testid="scrolling-bridge-container"
      className="relative w-full h-full overflow-hidden flex justify-center"
      style={{
        maskImage:
          "linear-gradient(to left, transparent 5%, white 30%, white 100%)",
      }}
    >
      <motion.div
        className="left-0 text-2xl whitespace-nowrap flex items-center"
        initial={{ x: "-25%" }}
        animate={{ x: "25%" }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      >
        <div
          className="scale-[0.4]"
          dangerouslySetInnerHTML={{ __html: svgContent }}
        />
      </motion.div>
    </div>
  );
};

export default ScrollingBridge;
