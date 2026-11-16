import {
  generateSingleTaskAlarmIcs,
  generateWorkspaceCalendarFeedIcs,
} from "./mobileAlarmProvider.js";

export { generateSingleTaskAlarmIcs, generateWorkspaceCalendarFeedIcs };

export const generateTaskCalendar = (tasks, leadTimeMinutes = 15) =>
  generateWorkspaceCalendarFeedIcs(tasks, "Todo Tasks", leadTimeMinutes);
