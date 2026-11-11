import { ReactNode } from "react";

export interface BentoCardProps {
  title: string;
  children: ReactNode;
  action?: ReactNode; // For things like the "Copy" button, timer, or status badges
  className?: string;
  testId?: string;
}

export function BentoCard({ title, children, action, className, testId }: BentoCardProps) {
  return (
    <section
      data-testid={testId}
      className={`flex flex-col bg-[#0A0A0A] border border-zinc-800/60 rounded-xl overflow-hidden shadow-sm [box-shadow:inset_0_1px_0_0_rgba(255,255,255,0.03)] transition-colors ${className || ""}`}
    >
      <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h3 className="text-[11px] font-semibold tracking-widest text-zinc-500 uppercase font-mono">
          {title}
        </h3>
        {action && <div>{action}</div>}
      </header>
      <div className="px-4 pb-4 text-sm text-zinc-300">
        {children}
      </div>
    </section>
  );
}
