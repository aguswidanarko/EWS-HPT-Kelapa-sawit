// Centralized error handler + async route wrapper so routes can `throw` / reject freely.

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // eslint-disable-next-line no-console
  console.error(err);
  const status = err.status || err.statusCode || 400;
  res.status(status).json({ error: err.message || 'Internal error' });
}

module.exports = { asyncHandler, errorHandler };
