import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Shell } from "@/components/vault";

export default function NotFound() {
  return (
    <Shell>
      <div className="max-w-md mx-auto bento-panel p-8 text-center">
        <p className="font-mono text-xs text-zinc-500 mb-2">404</p>
        <h1 className="font-serif text-2xl text-white mb-2">Page not found</h1>
        <p className="text-sm text-zinc-400 mb-6">The requested path does not exist.</p>
        <Link href="/" className="inline-flex items-center gap-2 bg-white text-black px-4 py-2 text-sm font-medium hover:bg-zinc-100">
          <ArrowLeft className="h-3.5 w-3.5" /> Return home
        </Link>
      </div>
    </Shell>
  );
}
