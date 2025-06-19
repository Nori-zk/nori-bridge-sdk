export const formatDisplayAddress = (address: string | null) => {
  return address ? `${address.substring(0, 6)}...${address.slice(-4)}` : null;
};
