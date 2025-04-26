export type ProgressTrackerStepProps = {
  title: string;
  isActive: boolean;
  isCompleted: boolean;
  first: boolean;
  last: boolean;
};

const ProgressTrackerStep = (props: ProgressTrackerStepProps) => {
  const { title, isActive, isCompleted } = props;

  const getStepClass = () => {
    if (isActive && !isCompleted) {
      return "text-white bg-darkGreen border border-lightGreen";
    } else if (isCompleted) {
      return "text-darkGreen bg-lightGreen";
    } else {
      return "text-white bg-darkGreen";
    }
  };

  return (
    <div className={`${getStepClass()} text-sm py-2 px-8 rounded-md`}>
      {title}
    </div>
  );
};

export default ProgressTrackerStep;
