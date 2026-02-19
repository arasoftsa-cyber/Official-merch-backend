const { getDb } = require("../src/config/db");

const QUIZ_JSON = {
  version: 1,
  title: "Smoke Drop Quiz",
  questions: [
    {
      id: "q1",
      type: "single_choice",
      prompt: "Which shirt color do you want?",
      options: ["Black", "White"],
      correct: "Black",
      points: 10,
      required: true,
    },
    {
      id: "q2",
      type: "text",
      prompt: "Tell us your vibe",
      required: false,
    },
  ],
};

async function main() {
  const db = getDb();

  const smokeDrop = await db("drops")
    .select("id", "handle")
    .where("handle", "like", "smoke-drop-%")
    .orderBy("created_at", "desc")
    .first();

  if (!smokeDrop) {
    throw new Error("No smoke drop found (handle like smoke-drop-%)");
  }

  await db("drops")
    .where({ id: smokeDrop.id })
    .update({ quiz_json: QUIZ_JSON });

  const updated = await db("drops")
    .select("id", "handle", "quiz_json")
    .where({ id: smokeDrop.id })
    .first();

  console.log(
    JSON.stringify(
      {
        updatedHandle: updated.handle,
        verifySql:
          "SELECT id, handle, quiz_json FROM public.drops WHERE handle = '" +
          updated.handle +
          "';",
        row: updated,
      },
      null,
      2
    )
  );

  await db.destroy();
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
