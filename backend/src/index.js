// Entry point.
require('./db/db'); // ensures schema is loaded before the app starts handling requests
const app = require('./app');

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`EWS HPT backend listening on http://localhost:${PORT}`);
});
