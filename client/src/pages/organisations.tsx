import { useEffect } from "react";
import { Mail, ArrowRight } from "lucide-react";
import { useLocation } from "wouter";
import { CONTACT_EMAIL } from "@shared/contact";
import { useI18n } from "@/lib/i18n";
import { Shell, useStartDemo } from "@/components/vault";

export default function Organisations() {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const demo = useStartDemo();

  return (
    <Shell wide>
      <div className="max-w-6xl mx-auto space-y-16 py-8">
        <section className="max-w-2xl space-y-4">
          <p className="font-mono text-xs uppercase tracking-widest text-zinc-500">Organisations</p>
          <h1 className="font-serif text-4xl sm:text-5xl tracking-tight text-white leading-tight">
            Structured dialogue without persistent records
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed max-w-xl">
            Diavanish supports Track II and professional mediation with ephemeral rooms, outcome summaries only, and cryptographic sealing. No full transcripts are retained.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <a href={`mailto:${CONTACT_EMAIL}`} className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-100">
              <Mail className="h-3.5 w-3.5" /> Contact
            </a>
            <button onClick={() => navigate("/facilitate?mode=apply")} className="inline-flex items-center gap-2 border border-white/[0.12] px-4 py-2 text-sm hover:border-white/20">
              Apply as facilitator <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </section>

        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            { h: "Track II", d: "Off-record dialogue between parties who cannot meet publicly." },
            { h: "Commercial", d: "Mediation of disputes without creating discoverable records." },
            { h: "Workplace", d: "Internal resolution with controlled visibility." },
            { h: "Cross-border", d: "Sessions spanning jurisdictions with minimal retention." },
          ].map((item) => (
            <div key={item.h} className="bento-panel p-5">
              <h3 className="font-serif text-lg text-white mb-2">{item.h}</h3>
              <p className="text-xs text-zinc-400 leading-relaxed">{item.d}</p>
            </div>
          ))}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bento-panel p-6">
            <h2 className="font-serif text-xl text-white mb-4">Limits</h2>
            <div className="space-y-4 text-sm text-zinc-400">
              <p>Participants can still screenshot or record outside the browser.</p>
              <p>Server retains room metadata and hashed invites. No full speech logs.</p>
              <p>Approved outcome summaries may be subject to legal process.</p>
            </div>
          </div>
          <div className="bento-panel p-6">
            <h2 className="font-serif text-xl text-white mb-4">Status</h2>
            <div className="space-y-4 text-sm text-zinc-400">
              <p>Pre-audit software. Self-hostable. Source available for inspection.</p>
              <p>Operator contact available for institutional deployments.</p>
            </div>
          </div>
        </section>

        <div className="bento-panel p-6 text-sm text-zinc-400">
          Diavanish reduces server-side speech retention. It does not create legal privilege. Copies made by participants remain outside system control.
        </div>
      </div>
    </Shell>
  );
}
