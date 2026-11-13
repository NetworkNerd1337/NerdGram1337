export type DrillSlide = {
  path: string;
  title: string;
  source: string | null;
  error: string | null;
};

export type DrillSession = {
  slides: DrillSlide[];
  index: number;
};

export function sessionStart(slide: DrillSlide): DrillSession {
  return { slides: [slide], index: 0 };
}

/** Keep a live root slide (the editor buffer, or a presentation poll) without dropping a drill-down. */
export function sessionSyncRoot(session: DrillSession, root: DrillSlide): DrillSession {
  const current = session.slides[0];
  if (!current || current.path !== root.path) return sessionStart(root);
  if (current.source === root.source && current.error === root.error && current.title === root.title) return session;
  const slides = session.slides.slice();
  slides[0] = root;
  return { ...session, slides };
}

/** Open a linked diagram after the current one and forget the forward history. */
export function sessionOpen(session: DrillSession, slide: DrillSlide): DrillSession {
  const slides = session.slides.slice(0, session.index + 1);
  const last = slides[slides.length - 1];
  if (last?.path === slide.path) {
    slides[slides.length - 1] = slide;
    return { slides, index: slides.length - 1 };
  }
  slides.push(slide);
  return { slides, index: slides.length - 1 };
}

export function sessionJump(session: DrillSession, index: number): DrillSession {
  if (!Number.isInteger(index) || index < 0 || index >= session.slides.length) return session;
  return { ...session, index };
}
