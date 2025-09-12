export function log(str: string): void {
  const tz: string = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  console.log(`${tz}: ${str}`);
}

export function error(str: string): void {
  const tz: string = new Date().toLocaleString("en-US", {
    timeZone: "America/New_York",
  });
  console.error(`${tz}: ${str}`);
}
