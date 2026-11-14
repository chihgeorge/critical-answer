// The question bank editor shows a group's questions 10 at a time (a 100-question pool was one long scroll).

export const QUESTIONS_PER_PAGE = 10;

/** The page to show (clamped: a delete may have emptied the last page), how many pages there are, and the
 * 0-based slice [start, end) of the group's questions on it. An empty group still has one (empty) page. */
export function questionPage(total: number, page: number, size = QUESTIONS_PER_PAGE) {
  const pages = Math.max(1, Math.ceil(total / size));
  const shown = Math.min(Math.max(0, page), pages - 1);
  return { page: shown, pages, start: shown * size, end: Math.min(total, (shown + 1) * size) };
}

/** The page a question at this 0-based index sits on: a new question (index = old length) opens its page. */
export const pageOf = (index: number, size = QUESTIONS_PER_PAGE): number => Math.floor(index / size);
