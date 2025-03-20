import Image from "next/image";
import TopBridge from "@/public/assets/Top-Bridge.svg";

const ScrollingBridge = () => {
  return (
    <div className="stroke-lightGreen fill-lightGreen w-full">
      <Image src={TopBridge} alt="bridge" className="stroke-lightGreen fill-lightGreen w-full" />
    </div>
  );
};

export default ScrollingBridge;
