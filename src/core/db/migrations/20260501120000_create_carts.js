"use strict";

exports.up = async (knex) => {
  const hasCarts = await knex.schema.hasTable("carts");
  if (!hasCarts) {
    await knex.schema.createTable("carts", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table
        .uuid("buyer_user_id")
        .notNullable()
        .references("id")
        .inTable("users")
        .onDelete("CASCADE");
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(["buyer_user_id"]);
      table.index(["buyer_user_id"]);
    });
  }

  const hasCartItems = await knex.schema.hasTable("cart_items");
  if (!hasCartItems) {
    await knex.schema.createTable("cart_items", (table) => {
      table.uuid("id").primary().defaultTo(knex.raw("gen_random_uuid()"));
      table
        .uuid("cart_id")
        .notNullable()
        .references("id")
        .inTable("carts")
        .onDelete("CASCADE");
      table
        .uuid("product_id")
        .notNullable()
        .references("id")
        .inTable("products");
      table
        .uuid("product_variant_id")
        .notNullable()
        .references("id")
        .inTable("product_variants");
      table.integer("quantity").notNullable().defaultTo(1);
      table.timestamp("created_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.timestamp("updated_at", { useTz: true }).notNullable().defaultTo(knex.fn.now());
      table.unique(["cart_id", "product_variant_id"]);
      table.index(["cart_id"]);
      table.index(["product_variant_id"]);
    });
  }

  await knex.raw(`
    alter table cart_items
    drop constraint if exists cart_items_quantity_positive_check
  `);
  await knex.raw(`
    alter table cart_items
    add constraint cart_items_quantity_positive_check
    check (quantity > 0)
  `);
};

exports.down = async (knex) => {
  await knex.raw(`
    alter table if exists cart_items
    drop constraint if exists cart_items_quantity_positive_check
  `);
  await knex.schema.dropTableIfExists("cart_items");
  await knex.schema.dropTableIfExists("carts");
};
