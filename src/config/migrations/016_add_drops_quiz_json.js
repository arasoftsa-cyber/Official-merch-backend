const SAMPLE_QUIZ = {
  title: "Drop Quiz",
  questions: [
    {
      id: "genre",
      type: "single_choice",
      prompt: "Which vibe matches this drop best?",
      options: ["Street", "Indie", "Classic"],
      required: true,
    },
    {
      id: "favorite_item",
      type: "single_choice",
      prompt: "Which item are you most likely to buy?",
      options: ["T-Shirt", "Hoodie", "Poster"],
      required: true,
    },
    {
      id: "message",
      type: "text",
      prompt: "Tell us why you want this drop.",
      required: false,
    },
  ],
};

exports.up = async (knex) => {
  const exists = await knex.schema.hasColumn("drops", "quiz_json");
  if (!exists) {
    await knex.schema.alterTable("drops", (table) => {
      table.jsonb("quiz_json").nullable();
    });
  }

  // Seed smoke drops so /drops/:id can render quiz questions in local dev.
  await knex("drops")
    .where("handle", "like", "smoke-drop-%")
    .update({ quiz_json: SAMPLE_QUIZ });
};

exports.down = async (knex) => {
  const exists = await knex.schema.hasColumn("drops", "quiz_json");
  if (exists) {
    await knex.schema.alterTable("drops", (table) => {
      table.dropColumn("quiz_json");
    });
  }
};
