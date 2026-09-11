export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");
  return res.status(410).json({
    success: false,
    status: "retired_pending_validation",
    error: "The predictive Entity Clarity endpoint is paused while its evidence inputs and longitudinal validation are rebuilt.",
    interpretation_boundary: "Prior static projections must not be interpreted as measured trajectory, ROI, fragility, or future model behavior."
  });
}
