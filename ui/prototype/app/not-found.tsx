import { Compass } from "lucide-react";

import { TomeEmpty } from "@/components/tome/TomeEmpty";

/**
 * Where the prototype stops.
 *
 * The navigation is the application's own, so it offers the whole platform —
 * chat, skills, the admin surfaces — while only TOME has been exported here.
 * Rather than let those links dead-end on a host's own 404, this says what
 * was reached and points back at the part that works.
 */
export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <TomeEmpty
        icon={<Compass />}
        headline="Not part of this prototype"
        hint="This is a static copy of TOME's own screens, with invented content and no server behind it. The rest of the platform is not included."
        action={{ label: "Back to the catalogue", href: "/projects" }}
      />
    </div>
  );
}
