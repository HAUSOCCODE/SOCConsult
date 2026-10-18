import { cloneElement, isValidElement, useEffect, useRef, useState } from "react";

// Preserve native table markup. Add a keyboard stop only when overflow exists.
export default function ResponsiveTable({ label, children, className = "" }) {
  const region = useRef(null);
  const [scrollable, setScrollable] = useState(false);
  useEffect(() => {
    const element = region.current;
    const measure = () => setScrollable(element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [children]);
  return <div ref={region} role="region" aria-label={label}
    tabIndex={scrollable ? 0 : undefined}
    className={`responsive-table-scroll focus-visible:ring-2 focus-visible:ring-maroon-400 ${className}`}>
    {isValidElement(children) && children.type === "table" ? cloneElement(children, { "aria-label": children.props["aria-label"] || label }) : children}
  </div>;
}
