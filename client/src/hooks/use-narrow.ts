import { useEffect, useState } from "react";

/** True below Tailwind's `sm` breakpoint (640px). */
export function useNarrow(query = "(max-width: 639px)") {
  const get = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return narrow;
}
