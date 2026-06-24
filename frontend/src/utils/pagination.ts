export const PAGE_SIZE = 111;

export const getVisiblePages = (
  current: number,
  total: number,
): (number | "ellipsis")[] => {
  if (total <= 7) {
    return Array.from({ length: total }, (_, index) => index + 1);
  }

  const pages = new Set<number>([1, total, current - 1, current, current + 1]);
  const visible = [...pages]
    .filter((pageNum) => pageNum >= 1 && pageNum <= total)
    .sort((a, b) => a - b);

  const result: (number | "ellipsis")[] = [];
  for (let index = 0; index < visible.length; index += 1) {
    const pageNum = visible[index];
    const previous = visible[index - 1];
    if (index > 0 && pageNum - previous > 1) {
      result.push("ellipsis");
    }
    result.push(pageNum);
  }

  return result;
};
