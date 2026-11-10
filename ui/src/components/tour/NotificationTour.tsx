"use client";

import { TourRunner } from "@/components/tour/TourRunner";
import {
  NOTIFICATION_TOUR,
  TOUR_START_EVENT,
  TOUR_STATE_KEY,
} from "@/components/tour/notification-tour";

/** The notifications walkthrough. Mounted once, in the app shell. */
export function NotificationTour() {
  return (
    <TourRunner
      tour={NOTIFICATION_TOUR}
      stateKey={TOUR_STATE_KEY}
      startEvent={TOUR_START_EVENT}
      label="Notifications walkthrough"
    />
  );
}
