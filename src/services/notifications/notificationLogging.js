export const logNotificationEvent = (event, details = {}) => {
  const write = event.endsWith(".failed") ? console.error : console.info;
  write(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      service: "task-reminders",
      event,
      ...details,
    }),
  );
};
