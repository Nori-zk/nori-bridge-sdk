import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const ScrollingMath = () => {
  const [mathTexts, setMathTexts] = useState<string[]>(["∫ dx ∫ x²z |₀¹⁰(x + 3y) dy = ..."]);

  useEffect(() => {
    const fetchMathText = async () => {
      try {
        const response = await fetch("https://api.mathjs.org/v4/?expr=2*atan(3)-sqrt(4)");
        const data = await response.text();

        setMathTexts((prev) => {
          if (prev.length < 20) {
            return [...prev, `∫ dx = ${data}`];
          } else {
            const newArray = [...prev];
            newArray.shift();
            return [...newArray, `∫ dx = ${data}`];
          }
        });
      } catch (error) {
        console.error("Error fetching math text:", error);
      }
    };

    const setRandomInterval = () => {
      fetchMathText();
      const randomDelay = Math.floor(Math.random() * (10000 - 2000 + 1)) + 2000;
      return setTimeout(setRandomInterval, randomDelay);
    };

    const timeout = setRandomInterval();

    return () => clearTimeout(timeout);
  }, []);

  return (
    <div
      className="relative w-full h-full overflow-hidden"
      style={{
        maskImage: "linear-gradient(to right, transparent 5%, white 30%, white 100%)",
      }}
    >
      {mathTexts.map((text, index) => (
        <motion.div
          key={index}
          className="top-1/2 left-0 text-lightGreen text-2xl whitespace-nowrap"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 10, repeat: Infinity, ease: "linear" }}
        >
          <div>{text}</div>
        </motion.div>
      ))}
    </div>
  );
};

export default ScrollingMath;
