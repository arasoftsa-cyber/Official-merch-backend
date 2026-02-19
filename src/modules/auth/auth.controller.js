const { signToken } = require("../../utils/jwt");
const { hashPassword, verifyPassword } = require("../../utils/password");
const userService = require("../users/user.service");

const ping = (req, res) => {
  res.json({ ok: true, module: "auth" });
};

const login = async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const user = await userService.findByEmail(email);

  if (!user) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json({ error: "invalid_credentials" });
  }

  const payload = {
    sub: user.id,
    email: user.email,
    role: user.role,
  };

  const accessToken = signToken(payload);

  return res.json({
    accessToken,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
};

const register = async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Email and password required" });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail) {
      return res
        .status(400)
        .json({ error: "validation_error", message: "Invalid email" });
    }

    if (typeof password !== "string" || password.length < 6) {
      return res.status(400).json({
        error: "validation_error",
        message: "Password must be at least 6 characters",
      });
    }

    const existing = await userService.findByEmail(normalizedEmail);
    if (existing) {
      return res.status(409).json({ error: "email_exists" });
    }

    const passwordHash = await hashPassword(password);
    const user = await userService.createUser({
      email: normalizedEmail,
      passwordHash,
      role: "buyer",
    });

    const payload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };
    const accessToken = signToken(payload);

    return res.status(200).json({
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth.register] failed", err);
    return res.status(500).json({ error: "internal_server_error" });
  }
};

module.exports = { ping, login, register };
