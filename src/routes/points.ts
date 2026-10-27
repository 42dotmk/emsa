import { Role } from "@/constants/enums";
import { ApiRoutes } from "@/constants/routes";
import { pointsAdjustmentSchema } from "@/constants/schemas";
import { parseBody, withRole } from "@/lib/middleware";
import { adjustPoints, getPointsHistory } from "@/lib/points";

const getMyPoints = withRole(
  Role.USER,
  async (_req, user) => {
    const history = await getPointsHistory(user.sub);
    if (!history) return Response.json({ error: "User not found" }, { status: 404 });
    return Response.json(history);
  },
  { allowIncomplete: true }
);

const getUserPoints = withRole<{ id: string }>(Role.ADMIN, async (req) => {
  const history = await getPointsHistory(req.params.id);
  if (!history) return Response.json({ error: "User not found" }, { status: 404 });
  return Response.json(history);
});

const adjustUserPoints = withRole<{ id: string }>(Role.SUPER_ADMIN, async (req, user) => {
  const { amount, note } = await parseBody(req, pointsAdjustmentSchema);
  const balance = await adjustPoints(user, req.params.id, amount, note);
  return Response.json({ balance }, { status: 201 });
});

export const pointRoutes = {
  [ApiRoutes.USERS_ME_POINTS]: { GET: getMyPoints },
  [ApiRoutes.ADMIN_USER_POINTS]: { GET: getUserPoints, POST: adjustUserPoints },
};
