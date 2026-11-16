const escapeIcsText = (value) =>
  String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");

const formatUtcDate = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Calendar event date must be valid");
  }
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
};

const foldLine = (line) => {
  const chunks = [];
  let chunk = "";
  let octets = 0;

  for (const character of line) {
    const characterOctets = Buffer.byteLength(character, "utf8");
    if (octets + characterOctets > 75) {
      chunks.push(chunk);
      chunk = ` ${character}`;
      octets = 1 + characterOctets;
    } else {
      chunk += character;
      octets += characterOctets;
    }
  }

  chunks.push(chunk);
  return chunks.join("\r\n");
};

const taskEvent = (task, leadTimeMinutes) => {
  const taskId = String(task.id || task._id || "");
  const dueAt = task.scheduledAt || task.dateTime;
  if (!taskId) throw new TypeError("Calendar task must have an ID");
  if (!dueAt) throw new TypeError("Calendar task must have a due date");

  const start = new Date(dueAt);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const taskUrl = `${process.env.TASK_APP_URL || process.env.FRONTEND_URL || "http://localhost:5173"}/?task=${encodeURIComponent(taskId)}`;
  const priority = task.priority || "Medium";
  const reminderMinutes = Math.max(1, Math.floor(Number(leadTimeMinutes) || 15));
  const sequenceDate = new Date(task.updatedAt || task.createdAt || 0);
  const sequence = Number.isNaN(sequenceDate.getTime())
    ? 0
    : Math.max(0, Math.floor(sequenceDate.getTime() / 1000));
  const alarmDescription = escapeIcsText(`⏰ Task Due Soon: ${task.title}`);

  return [
    "BEGIN:VEVENT",
    `UID:task-${escapeIcsText(taskId)}@todo-app`,
    `DTSTAMP:${formatUtcDate(new Date())}`,
    `DTSTART:${formatUtcDate(start)}`,
    `DTEND:${formatUtcDate(end)}`,
    "STATUS:CONFIRMED",
    `SEQUENCE:${sequence}`,
    `SUMMARY:${escapeIcsText(task.title)}`,
    `DESCRIPTION:${escapeIcsText(`${task.description || ""}${task.description ? "\n" : ""}Priority: ${priority}`)}`,
    `X-TODO-PRIORITY:${escapeIcsText(priority)}`,
    `URL:${escapeIcsText(taskUrl)}`,
    "BEGIN:VALARM",
    `TRIGGER:-PT${reminderMinutes}M`,
    "ACTION:DISPLAY",
    `DESCRIPTION:${alarmDescription}`,
    "END:VALARM",
    "BEGIN:VALARM",
    `TRIGGER:-PT${reminderMinutes}M`,
    "ACTION:AUDIO",
    `DESCRIPTION:${alarmDescription}`,
    "END:VALARM",
    "END:VEVENT",
  ];
};

const calendar = (events, calendarName) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Todo Express//Mobile Task Alarms//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
    ...events.flat(),
    "END:VCALENDAR",
  ]
    .map(foldLine)
    .join("\r\n")
    .concat("\r\n");

export const generateSingleTaskAlarmIcs = (task, leadTimeMinutes = 15) =>
  calendar([taskEvent(task, leadTimeMinutes)], task.title || "Task Alarm");

export const generateWorkspaceCalendarFeedIcs = (
  tasks,
  workspaceName,
  leadTimeMinutes = 15,
) =>
  calendar(
    tasks
      .filter((task) => task.status === "In Progress")
      .map((task) => taskEvent(task, leadTimeMinutes)),
    workspaceName || "Todo Calendar",
  );
