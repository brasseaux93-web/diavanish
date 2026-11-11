import { Shell, useStartDemo } from "@/components/vault";
import { LandingHero } from "@/components/LandingHero";
import { SessionSpecsAndCTA } from "@/components/SessionSpecsAndCTA";

export default function Entry() {
  const demo = useStartDemo();

  return (
    <Shell wide>
      {/* 1. HERO & WORKFLOW PREVIEW: 12-Column Responsive Grid */}
      <LandingHero demo={demo} />

      {/* 2. SPECIFICATIONS, POLICY BOUNDARIES & BOTTOM BANNER: Bento Grid Matrix */}
      <SessionSpecsAndCTA demo={demo} />
    </Shell>
  );
}
