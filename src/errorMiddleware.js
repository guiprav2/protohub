function errorMiddleware(err, req, res, next) {
  if (!err) { return }
  console.error(err, JSON.stringify({ reqId: req.id }));
  res.status(500).send(`Error: ${req.id}`);
}

export default errorMiddleware;