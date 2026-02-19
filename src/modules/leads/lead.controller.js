const { createLead } = require("./lead.service");
const { getDb } = require("../../config/db");

const CONTACT_REQUIRED = { error: "lead_contact_required" };
const MAX_LEN = {
  name: 120,
  email: 320,
  phone: 32,
  source: 80,
  handle: 80,
};

const trimToNull = (value) => {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length > 0 ? text : null;
};

const exceedsMaxLen = (value, max) => typeof value === "string" && value.length > max;

const postLead = async (req, res, next) => {
  try {
    const {
      source,
      dropHandle,
      drop_handle,
      dropId,
      drop_id,
      artistHandle,
      artist_handle,
      artistId,
      artist_id,
      name,
      phone,
      email,
      answers,
      answers_json,
    } = req.body || {};

    const normalizedName = trimToNull(name);
    const normalizedEmail = trimToNull(email);
    const normalizedPhone = trimToNull(phone);
    const normalizedSource = trimToNull(source);

    if (!normalizedPhone && !normalizedEmail) {
      return res.status(400).json(CONTACT_REQUIRED);
    }

    if (exceedsMaxLen(normalizedName, MAX_LEN.name)) {
      return res.status(400).json({ error: "validation_error", field: "name" });
    }
    if (exceedsMaxLen(normalizedEmail, MAX_LEN.email)) {
      return res.status(400).json({ error: "validation_error", field: "email" });
    }
    if (exceedsMaxLen(normalizedPhone, MAX_LEN.phone)) {
      return res.status(400).json({ error: "validation_error", field: "phone" });
    }
    if (exceedsMaxLen(normalizedSource, MAX_LEN.source)) {
      return res.status(400).json({ error: "validation_error", field: "source" });
    }

    const requestedDropHandle = trimToNull(dropHandle || drop_handle);
    const requestedDropId = trimToNull(dropId || drop_id);
    const requestedArtistHandle = trimToNull(artistHandle || artist_handle);
    const requestedArtistId = trimToNull(artistId || artist_id);

    if (exceedsMaxLen(requestedDropHandle, MAX_LEN.handle)) {
      return res.status(400).json({ error: "validation_error", field: "drop_handle" });
    }
    if (exceedsMaxLen(requestedArtistHandle, MAX_LEN.handle)) {
      return res.status(400).json({ error: "validation_error", field: "artist_handle" });
    }

    const normalizedAnswersBase =
      (answers_json && typeof answers_json === "object" ? answers_json : null) ||
      (answers && typeof answers === "object"
        ? {
            dropId: requestedDropId || answers.dropId || null,
            answers: answers.answers && typeof answers.answers === "object" ? answers.answers : answers,
          }
        : null);

    const db = getDb();
    const effectiveDropId = requestedDropId || normalizedAnswersBase?.dropId || null;

    let drop = null;
    if (effectiveDropId) {
      drop = await db("drops")
        .select("id", "handle", "artist_id", "quiz_json")
        .where({ id: effectiveDropId })
        .first();
    }
    if (!drop && requestedDropHandle) {
      drop = await db("drops")
        .select("id", "handle", "artist_id", "quiz_json")
        .where({ handle: requestedDropHandle })
        .first();
    }

    let resolvedArtistHandle = requestedArtistHandle || null;
    if (!resolvedArtistHandle && requestedArtistId) {
      const artistById = await db("artists")
        .select("handle")
        .where({ id: requestedArtistId })
        .first();
      resolvedArtistHandle = artistById?.handle || null;
    }
    if (!resolvedArtistHandle && drop?.artist_id) {
      const artistByDrop = await db("artists")
        .select("handle")
        .where({ id: drop.artist_id })
        .first();
      resolvedArtistHandle = artistByDrop?.handle || null;
    }

    const answersMap =
      normalizedAnswersBase?.answers && typeof normalizedAnswersBase.answers === "object"
        ? normalizedAnswersBase.answers
        : {};

    let score = 0;
    let maxScore = 0;
    const questions = Array.isArray(drop?.quiz_json?.questions) ? drop.quiz_json.questions : [];
    for (const question of questions) {
      if (question?.type !== "single_choice" || !question?.correct) continue;
      const pts = Number.isFinite(Number(question?.points)) ? Number(question.points) : 1;
      maxScore += pts;
      if (answersMap[question.id] === question.correct) {
        score += pts;
      }
    }

    const normalizedAnswers = {
      ...(normalizedAnswersBase || {}),
      dropId: effectiveDropId || normalizedAnswersBase?.dropId || drop?.id || null,
      answers: answersMap,
      attribution: {
        drop_id: effectiveDropId || drop?.id || null,
        drop_handle: requestedDropHandle || drop?.handle || null,
        artist_id: requestedArtistId || drop?.artist_id || null,
        artist_handle: resolvedArtistHandle || null,
      },
      score,
      maxScore,
    };

    const lead = await createLead({
      source: normalizedSource,
      dropHandle: requestedDropHandle || drop?.handle || null,
      artistHandle: resolvedArtistHandle,
      name: normalizedName,
      phone: normalizedPhone,
      email: normalizedEmail,
      answers: normalizedAnswers,
    });

    res.status(200).json({ ok: true, leadId: lead.id });
  } catch (err) {
    next(err);
  }
};

module.exports = { postLead };
