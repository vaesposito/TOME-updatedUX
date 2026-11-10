"use client";

import { TourRunner } from "@/components/tour/TourRunner";
import {
  FEATURE_TOUR,
  FEATURE_TOUR_START_EVENT,
  FEATURE_TOUR_STATE_KEY,
} from "@/components/tour/feature-tour";

/** The tour of TOME's features. Mounted once, in the app shell. */
export function FeatureTour() {
  return (
    <TourRunner
      tour={FEATURE_TOUR}
      stateKey={FEATURE_TOUR_STATE_KEY}
      startEvent={FEATURE_TOUR_START_EVENT}
      label="TOME walkthrough"
    />
  );
}
