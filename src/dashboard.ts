import app from "./app.js";

const PORT = Number(process.env.PORT ?? 4150);

app.listen(PORT, () => {
  console.log(`SPEC MIGRATOR 5000  http://127.0.0.1:${PORT}/`);
});
