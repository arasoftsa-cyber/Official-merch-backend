--
-- PostgreSQL database dump
--

\restrict ewbrurpq4wsRgUXyBSwoUy2oEBiLlwY7uu58SIYvzwJ9iouHhqd8O2RUr0ccVNE

-- Dumped from database version 13.23
-- Dumped by pg_dump version 13.23

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA public;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: artist_access_requests; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.artist_access_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_name character varying(255) NOT NULL,
    handle character varying(255),
    contact_email character varying(255) NOT NULL,
    contact_phone character varying(255),
    socials jsonb,
    pitch text,
    status character varying(255) DEFAULT 'pending'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    decided_at timestamp with time zone,
    decided_by_user_id uuid,
    requestor_user_id uuid,
    CONSTRAINT artist_access_requests_status_check CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'approved'::character varying, 'denied'::character varying])::text[])))
);


ALTER TABLE public.artist_access_requests OWNER TO omuser;

--
-- Name: artist_user_map; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.artist_user_map (
    id uuid NOT NULL,
    artist_id uuid NOT NULL,
    user_id uuid NOT NULL
);


ALTER TABLE public.artist_user_map OWNER TO omuser;

--
-- Name: artists; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.artists (
    id uuid NOT NULL,
    handle text NOT NULL,
    name text NOT NULL,
    theme_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    is_featured boolean DEFAULT false NOT NULL
);


ALTER TABLE public.artists OWNER TO omuser;

--
-- Name: drop_products; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.drop_products (
    drop_id uuid NOT NULL,
    product_id uuid NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.drop_products OWNER TO omuser;

--
-- Name: drops; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.drops (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    handle character varying(255) NOT NULL,
    title character varying(255) NOT NULL,
    description text,
    hero_image_url text,
    status character varying(255) DEFAULT 'draft'::character varying NOT NULL,
    starts_at timestamp with time zone,
    ends_at timestamp with time zone,
    artist_id uuid,
    label_id uuid,
    created_by_user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    quiz_json jsonb,
    CONSTRAINT drops_owner_check CHECK ((((artist_id IS NOT NULL) AND (label_id IS NULL)) OR ((artist_id IS NULL) AND (label_id IS NOT NULL)))),
    CONSTRAINT drops_status_check CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'published'::character varying, 'archived'::character varying])::text[])))
);


ALTER TABLE public.drops OWNER TO omuser;

--
-- Name: entity_media_links; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.entity_media_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    media_asset_id uuid NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid NOT NULL,
    role text NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT entity_media_links_entity_type_check CHECK ((entity_type = ANY (ARRAY['artist'::text, 'drop'::text, 'product'::text]))),
    CONSTRAINT entity_media_links_role_check CHECK ((role = ANY (ARRAY['cover'::text, 'avatar'::text, 'gallery'::text])))
);


ALTER TABLE public.entity_media_links OWNER TO omuser;

--
-- Name: knex_migrations; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.knex_migrations (
    id integer NOT NULL,
    name character varying(255),
    batch integer,
    migration_time timestamp with time zone
);


ALTER TABLE public.knex_migrations OWNER TO omuser;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE; Schema: public; Owner: omuser
--

CREATE SEQUENCE public.knex_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.knex_migrations_id_seq OWNER TO omuser;

--
-- Name: knex_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: omuser
--

ALTER SEQUENCE public.knex_migrations_id_seq OWNED BY public.knex_migrations.id;


--
-- Name: knex_migrations_lock; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.knex_migrations_lock (
    index integer NOT NULL,
    is_locked integer
);


ALTER TABLE public.knex_migrations_lock OWNER TO omuser;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE; Schema: public; Owner: omuser
--

CREATE SEQUENCE public.knex_migrations_lock_index_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.knex_migrations_lock_index_seq OWNER TO omuser;

--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: omuser
--

ALTER SEQUENCE public.knex_migrations_lock_index_seq OWNED BY public.knex_migrations_lock.index;


--
-- Name: label_artist_map; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.label_artist_map (
    id uuid NOT NULL,
    label_id uuid NOT NULL,
    artist_id uuid NOT NULL
);


ALTER TABLE public.label_artist_map OWNER TO omuser;

--
-- Name: label_users_map; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.label_users_map (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    label_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.label_users_map OWNER TO omuser;

--
-- Name: labels; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.labels (
    id uuid NOT NULL,
    handle text NOT NULL,
    name text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.labels OWNER TO omuser;

--
-- Name: leads; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.leads (
    id uuid NOT NULL,
    source text,
    drop_handle text,
    artist_handle text,
    name text,
    phone text,
    email text,
    answers_json jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    status text DEFAULT 'new'::text NOT NULL,
    admin_note text,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.leads OWNER TO omuser;

--
-- Name: media_assets; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    public_url text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.media_assets OWNER TO omuser;

--
-- Name: order_events; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.order_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    type character varying(255) NOT NULL,
    actor_user_id uuid NOT NULL,
    note text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT order_events_type_check CHECK (((type)::text = ANY ((ARRAY['placed'::character varying, 'cancelled'::character varying, 'fulfilled'::character varying])::text[])))
);


ALTER TABLE public.order_events OWNER TO omuser;

--
-- Name: order_items; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.order_items (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    product_id uuid NOT NULL,
    product_variant_id uuid NOT NULL,
    quantity integer NOT NULL,
    price_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.order_items OWNER TO omuser;

--
-- Name: orders; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.orders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    buyer_user_id uuid NOT NULL,
    status character varying(255) DEFAULT 'placed'::character varying NOT NULL,
    total_cents integer NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT orders_status_check CHECK (((status)::text = ANY ((ARRAY['placed'::character varying, 'cancelled'::character varying, 'fulfilled'::character varying])::text[])))
);


ALTER TABLE public.orders OWNER TO omuser;

--
-- Name: payment_attempts; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.payment_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid NOT NULL,
    status text NOT NULL,
    provider text NOT NULL,
    provider_attempt_id text,
    meta_json jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    CONSTRAINT payment_attempts_status_check CHECK ((status = ANY (ARRAY['created'::text, 'succeeded'::text, 'failed'::text])))
);


ALTER TABLE public.payment_attempts OWNER TO omuser;

--
-- Name: payment_events; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.payment_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    payment_id uuid,
    event_type text NOT NULL,
    provider text NOT NULL,
    provider_event_id text,
    payload_json jsonb,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.payment_events OWNER TO omuser;

--
-- Name: payments; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.payments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    order_id uuid NOT NULL,
    status text DEFAULT 'unpaid'::text NOT NULL,
    provider text DEFAULT 'mock'::text NOT NULL,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'INR'::text NOT NULL,
    provider_payment_id text,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    provider_order_id text,
    provider_signature text,
    paid_at timestamp with time zone,
    CONSTRAINT payments_status_check CHECK ((status = ANY (ARRAY['unpaid'::text, 'pending'::text, 'paid'::text, 'failed'::text, 'refunded'::text])))
);


ALTER TABLE public.payments OWNER TO omuser;

--
-- Name: product_variants; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.product_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    product_id uuid NOT NULL,
    sku text NOT NULL,
    size text NOT NULL,
    color text NOT NULL,
    price_cents integer NOT NULL,
    stock integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.product_variants OWNER TO omuser;

--
-- Name: products; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.products (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    artist_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    is_active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.products OWNER TO omuser;

--
-- Name: users; Type: TABLE; Schema: public; Owner: omuser
--

CREATE TABLE public.users (
    id uuid NOT NULL,
    email text NOT NULL,
    password_hash text NOT NULL,
    role text NOT NULL,
    created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.users OWNER TO omuser;

--
-- Name: knex_migrations id; Type: DEFAULT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.knex_migrations ALTER COLUMN id SET DEFAULT nextval('public.knex_migrations_id_seq'::regclass);


--
-- Name: knex_migrations_lock index; Type: DEFAULT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.knex_migrations_lock ALTER COLUMN index SET DEFAULT nextval('public.knex_migrations_lock_index_seq'::regclass);


--
-- Data for Name: artist_access_requests; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.artist_access_requests (id, artist_name, handle, contact_email, contact_phone, socials, pitch, status, created_at, decided_at, decided_by_user_id, requestor_user_id) FROM stdin;
93f98414-a082-442b-bfbe-adbb9f338918	bal	sample	sample@sample.com	123456789	{"link": "@sample"}	please accept me	approved	2026-02-20 05:47:00.70037+00	2026-02-20 05:48:19.543791+00	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	d9a00e14-3489-4030-b01f-4465a0ff8b38
093c54c1-a3d1-49e1-bc02-8424e5595d90	Roney Guha	RoneyGuha	sourav.aka.roney@gmail.com	7603026993	\N	\N	approved	2026-02-20 06:48:14.723494+00	2026-02-20 08:25:15.047713+00	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	df267245-467c-43b2-b40e-dc77ad0b8982
1d43c77b-34ff-426d-adc8-151b431aba2e	Smoke Apply Artist	smoke-apply-artist	smoke.apply.1771577429453@test.com	9999999999	\N	Smoke application request for artist onboarding.	pending	2026-02-20 08:50:33.573554+00	\N	\N	1edfd56f-99b2-40d4-a6b1-1a19c6cfdcb1
77b58490-103f-4c79-8c48-088dcf7587d6	Smoke Apply Artist	smoke-apply-artist	smoke.apply.1771579007209@test.com	9999999999	\N	Smoke application request for artist onboarding.	pending	2026-02-20 09:16:50.601209+00	\N	\N	1edfd56f-99b2-40d4-a6b1-1a19c6cfdcb1
5b83b58f-7ca0-4158-b2e2-3d2cf19055bd	Smoke Apply Artist	smoke-apply-artist	smoke.apply.1771589231790@test.com	9999999999	\N	Smoke application request for artist onboarding.	pending	2026-02-20 12:07:16.011996+00	\N	\N	8ab8e1ac-ba60-49eb-8369-022ede51c676
c8cdf8a3-0626-45ec-9a4e-b5024ebe28d7	Smoke Apply Artist	smoke-apply-artist	smoke.apply.1771590386349@test.com	9999999999	\N	Smoke application request for artist onboarding.	pending	2026-02-20 12:26:30.248529+00	\N	\N	8ab8e1ac-ba60-49eb-8369-022ede51c676
da7cfe6f-e51b-4289-b718-58abffff2501	Smoke Apply Artist	smoke-apply-artist	smoke.apply.1771590501046@test.com	9999999999	\N	Smoke application request for artist onboarding.	pending	2026-02-20 12:28:25.158297+00	\N	\N	8ab8e1ac-ba60-49eb-8369-022ede51c676
\.


--
-- Data for Name: artist_user_map; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.artist_user_map (id, artist_id, user_id) FROM stdin;
87988ec7-f537-4b0f-ad2a-844ed939e10b	8e28dfca-24ad-4ab7-9aa2-a685260df2e3	d9a00e14-3489-4030-b01f-4465a0ff8b38
87757e26-489e-45c4-8450-01066ce58e61	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	df267245-467c-43b2-b40e-dc77ad0b8982
\.


--
-- Data for Name: artists; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.artists (id, handle, name, theme_json, created_at, is_featured) FROM stdin;
8e28dfca-24ad-4ab7-9aa2-a685260df2e3	sample	bal	{}	2026-02-20 05:48:19.543791+00	f
2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	roneyguha	Roney Guha	{}	2026-02-20 08:25:15.047713+00	f
\.


--
-- Data for Name: drop_products; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.drop_products (drop_id, product_id, sort_order, created_at) FROM stdin;
530e7f68-64da-48e3-95f6-a99b907b3bb5	c3e3afe3-fe6c-490a-91ac-d75da1a3433a	0	2026-02-20 12:47:55.421071+00
c03de595-54b0-4231-806e-d09968132f29	f9b715b5-731b-4ce8-bec7-1352be224c67	0	2026-02-20 13:08:25.60509+00
cd0fb7fb-1c06-4e74-8318-8777cd70c790	f9b715b5-731b-4ce8-bec7-1352be224c67	0	2026-02-20 13:16:07.623035+00
2aadccaf-5e80-4c65-b3ff-8a451cd05798	f9b715b5-731b-4ce8-bec7-1352be224c67	0	2026-02-20 13:22:42.584789+00
ff2ad0ba-5b02-4c52-a5ad-542fb88aa67e	f9b715b5-731b-4ce8-bec7-1352be224c67	0	2026-02-20 13:46:36.7545+00
eb3611ee-91a1-4aca-bafe-ea15ada73b9a	f9b715b5-731b-4ce8-bec7-1352be224c67	0	2026-02-20 13:58:51.257341+00
\.


--
-- Data for Name: drops; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.drops (id, handle, title, description, hero_image_url, status, starts_at, ends_at, artist_id, label_id, created_by_user_id, created_at, updated_at, quiz_json) FROM stdin;
cd0fb7fb-1c06-4e74-8318-8777cd70c790	ui-smoke-drop-1771593361345	UI Smoke Drop 1771593361345	\N	\N	published	\N	\N	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 13:16:06.683292+00	2026-02-20 13:16:09.315309+00	\N
2aadccaf-5e80-4c65-b3ff-8a451cd05798	ui-smoke-drop-1771593757384	UI Smoke Drop 1771593757384	\N	\N	published	\N	\N	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 13:22:41.936146+00	2026-02-20 13:22:43.90659+00	\N
ff2ad0ba-5b02-4c52-a5ad-542fb88aa67e	ui-smoke-drop-1771595191722	UI Smoke Drop 1771595191722	\N	\N	published	\N	\N	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 13:46:36.125384+00	2026-02-20 13:46:38.124643+00	\N
eb3611ee-91a1-4aca-bafe-ea15ada73b9a	ui-smoke-drop-1771595926154	UI Smoke Drop 1771595926154	\N	\N	published	\N	\N	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 13:58:50.618562+00	2026-02-20 13:58:52.641772+00	\N
c03de595-54b0-4231-806e-d09968132f29	ui-smoke-drop-1771592900498	UI Smoke Drop 1771592900498	\N	\N	published	\N	\N	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 13:08:24.943907+00	2026-02-20 14:03:04.959195+00	\N
530e7f68-64da-48e3-95f6-a99b907b3bb5	foo	foo	\N	\N	published	\N	\N	8e28dfca-24ad-4ab7-9aa2-a685260df2e3	\N	9f2e9e97-b9f2-42ec-89f4-b654f4789aef	2026-02-20 11:59:55.898928+00	2026-02-20 14:03:56.548991+00	{"title": "Smoke Drop Quiz", "version": 1, "questions": [{"id": "q1", "type": "single_choice", "points": 10, "prompt": "Which shirt color do you want?", "correct": "Black", "options": ["Black", "White"], "required": true}, {"id": "q2", "type": "text", "prompt": "Tell us your vibe", "required": false}]}
\.


--
-- Data for Name: entity_media_links; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.entity_media_links (id, media_asset_id, entity_type, entity_id, role, sort_order, created_at) FROM stdin;
\.


--
-- Data for Name: knex_migrations; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.knex_migrations (id, name, batch, migration_time) FROM stdin;
1	001_create_users_and_maps.js	1	2026-02-19 19:47:51.034+00
2	002_create_artists_and_labels.js	1	2026-02-19 19:47:51.044+00
3	003_create_products_and_variants.js	1	2026-02-19 19:47:51.054+00
4	004_create_drops_and_drop_products.js	1	2026-02-19 19:47:51.068+00
5	005_create_orders_and_order_items.js	1	2026-02-19 19:47:51.075+00
6	006_create_order_events.js	1	2026-02-19 19:47:51.08+00
7	007_create_payments_and_attempts.js	1	2026-02-19 19:47:51.094+00
8	008_create_payment_events.js	1	2026-02-19 19:47:51.098+00
9	009_extend_payments_and_events.js	1	2026-02-19 19:47:51.1+00
10	010_create_leads_table.js	1	2026-02-19 19:47:51.102+00
11	011_create_artist_access_requests.js	1	2026-02-19 19:47:51.109+00
12	012_create_label_users_map.js	1	2026-02-19 19:47:51.121+00
13	013_products_uuid_defaults.js	1	2026-02-19 19:47:51.122+00
14	014_product_variants_stock_default.js	1	2026-02-19 19:47:51.123+00
15	015_add_artist_featured_flag.js	1	2026-02-19 19:47:51.127+00
16	016_add_drops_quiz_json.js	1	2026-02-19 19:47:51.132+00
17	017_add_drops_quiz_json_column.js	1	2026-02-19 19:47:51.133+00
18	018_add_leads_pipeline_fields.js	1	2026-02-19 19:47:51.139+00
19	019_create_media_assets_and_entity_media_links.js	1	2026-02-19 19:47:51.155+00
20	020_add_artist_access_requests_requestor_user_id.js	1	2026-02-19 19:47:51.16+00
21	20260217121020_create_db_table.js	1	2026-02-19 19:47:51.16+00
\.


--
-- Data for Name: knex_migrations_lock; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.knex_migrations_lock (index, is_locked) FROM stdin;
1	0
\.


--
-- Data for Name: label_artist_map; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.label_artist_map (id, label_id, artist_id) FROM stdin;
\.


--
-- Data for Name: label_users_map; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.label_users_map (id, user_id, label_id, created_at) FROM stdin;
\.


--
-- Data for Name: labels; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.labels (id, handle, name, created_at) FROM stdin;
\.


--
-- Data for Name: leads; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.leads (id, source, drop_handle, artist_handle, name, phone, email, answers_json, created_at, status, admin_note, updated_at) FROM stdin;
\.


--
-- Data for Name: media_assets; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.media_assets (id, public_url, created_at) FROM stdin;
\.


--
-- Data for Name: order_events; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.order_events (id, order_id, type, actor_user_id, note, created_at) FROM stdin;
aa183f54-f5f5-4e20-963b-980a777a2bee	11b130ae-fa40-441c-afc4-f6e48ec53bc6	placed	8ab8e1ac-ba60-49eb-8369-022ede51c676	\N	2026-02-20 12:56:21.978234+00
\.


--
-- Data for Name: order_items; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.order_items (id, order_id, product_id, product_variant_id, quantity, price_cents, created_at) FROM stdin;
9a5ffec7-2963-451c-a70b-f5eb6ccfe36b	11b130ae-fa40-441c-afc4-f6e48ec53bc6	c3e3afe3-fe6c-490a-91ac-d75da1a3433a	dca4b2b8-434f-4d66-b24f-bb6d26945a53	1	1000	2026-02-20 12:56:21.978234+00
\.


--
-- Data for Name: orders; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.orders (id, buyer_user_id, status, total_cents, created_at, updated_at) FROM stdin;
11b130ae-fa40-441c-afc4-f6e48ec53bc6	8ab8e1ac-ba60-49eb-8369-022ede51c676	placed	1000	2026-02-20 12:56:21.978234+00	2026-02-20 12:56:21.978234+00
\.


--
-- Data for Name: payment_attempts; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.payment_attempts (id, payment_id, status, provider, provider_attempt_id, meta_json, created_at) FROM stdin;
\.


--
-- Data for Name: payment_events; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.payment_events (id, payment_id, event_type, provider, provider_event_id, payload_json, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.payments (id, order_id, status, provider, amount_cents, currency, provider_payment_id, created_at, updated_at, provider_order_id, provider_signature, paid_at) FROM stdin;
9fd8896f-e780-4cb9-a827-9a6b8cbc9b60	11b130ae-fa40-441c-afc4-f6e48ec53bc6	unpaid	mock	1000	INR	\N	2026-02-20 12:56:21.978234+00	2026-02-20 12:56:21.978234+00	\N	\N	\N
\.


--
-- Data for Name: product_variants; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.product_variants (id, product_id, sku, size, color, price_cents, stock, created_at) FROM stdin;
b11a449c-2a7b-469f-b9c5-a5e497145a74	f9b715b5-731b-4ce8-bec7-1352be224c67	SKU-f9b715b5-M-DEFAULT	M	default	1999	10	2026-02-20 08:25:31.245181+00
f6f19ff5-bb43-4ebb-8595-508dca615323	c3e3afe3-fe6c-490a-91ac-d75da1a3433a	SKU-c3e3afe3-M-DEFAULT	M	default	3300	5	2026-02-20 11:59:39.036186+00
dca4b2b8-434f-4d66-b24f-bb6d26945a53	c3e3afe3-fe6c-490a-91ac-d75da1a3433a	SKU-c3e3afe3-L-special	L	special	1000	1	2026-02-20 12:50:00.38982+00
71ce2a1b-23e8-4634-88c4-134290b85448	14122a31-e6af-43ed-bc51-c6f0ebc0de28	SKU-14122a31-M-DEFAULT	M	default	2999	12	2026-02-20 13:15:40.730368+00
b5e8a3fc-a88a-4292-a112-5ed23b6fd3a6	27fc4077-8fcc-4e2b-b39d-6c1bdfb21eda	SKU-27fc4077-M-DEFAULT	M	default	200	1	2026-02-20 13:51:15.161608+00
cd6a7a3b-35b9-47ba-902b-92dd385e4fdf	27fc4077-8fcc-4e2b-b39d-6c1bdfb21eda	ff	B	nil	3	3	2026-02-20 13:54:36.540432+00
b3218a79-f87e-4398-9683-c045bce143b0	27fc4077-8fcc-4e2b-b39d-6c1bdfb21eda	gg	L	kalo	4	4	2026-02-20 13:55:19.176927+00
\.


--
-- Data for Name: products; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.products (id, artist_id, title, description, is_active, created_at) FROM stdin;
f9b715b5-731b-4ce8-bec7-1352be224c67	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	Waqt	asasda	t	2026-02-20 08:25:31.242415+00
14122a31-e6af-43ed-bc51-c6f0ebc0de28	2d6d7f0a-36c3-4887-b41c-0d0061c0e04b	Smoke Admin Product 1771593338363	Created by admin smoke	t	2026-02-20 13:15:40.72876+00
c3e3afe3-fe6c-490a-91ac-d75da1a3433a	8e28dfca-24ad-4ab7-9aa2-a685260df2e3	haga	\N	f	2026-02-20 11:59:39.029779+00
27fc4077-8fcc-4e2b-b39d-6c1bdfb21eda	8e28dfca-24ad-4ab7-9aa2-a685260df2e3	jali	\N	t	2026-02-20 13:51:15.159879+00
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: omuser
--

COPY public.users (id, email, password_hash, role, created_at) FROM stdin;
9f2e9e97-b9f2-42ec-89f4-b654f4789aef	admin@officialmerch.in	$2a$10$gymjiFzTbwxYgexUwmpBM.9AUAWzhgJD4Wbh0A1u/6J8IXii/MrZe	admin	2026-02-19 21:11:10.406081+00
d9a00e14-3489-4030-b01f-4465a0ff8b38	sample@sample.com	$2a$10$GBIsE67bruojVV0jYD5qbuRysXYui/PNvOOsgq/SJECNnN1YE54oW	artist	2026-02-20 05:24:46.175093+00
1edfd56f-99b2-40d4-a6b1-1a19c6cfdcb1	fail@fail.com	$2a$10$yo2gqA5X2pSu0dRoEa92keCCyMJYlvh6kze3CxZHpfKRnlZTCWmva	buyer	2026-02-20 05:56:58.765313+00
df267245-467c-43b2-b40e-dc77ad0b8982	sourav.aka.roney@gmail.com	$2a$10$K1YcVhQvriSSss0HbwKZa.MFHm6scSZhDVVd7pKFWPUgRC6kx11cu	artist	2026-02-20 06:47:12.099573+00
8ab8e1ac-ba60-49eb-8369-022ede51c676	buyer@test.com	$2a$10$Qx2PONK0St1q7oeT6Pq2q.HGboLdwlKUyPrgWDBW2/eA.XBSb2scm	buyer	2026-02-20 12:03:46.012875+00
\.


--
-- Name: knex_migrations_id_seq; Type: SEQUENCE SET; Schema: public; Owner: omuser
--

SELECT pg_catalog.setval('public.knex_migrations_id_seq', 21, true);


--
-- Name: knex_migrations_lock_index_seq; Type: SEQUENCE SET; Schema: public; Owner: omuser
--

SELECT pg_catalog.setval('public.knex_migrations_lock_index_seq', 1, true);


--
-- Name: artist_access_requests artist_access_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_access_requests
    ADD CONSTRAINT artist_access_requests_pkey PRIMARY KEY (id);


--
-- Name: artist_user_map artist_user_map_artist_id_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_user_map
    ADD CONSTRAINT artist_user_map_artist_id_user_id_unique UNIQUE (artist_id, user_id);


--
-- Name: artist_user_map artist_user_map_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_user_map
    ADD CONSTRAINT artist_user_map_pkey PRIMARY KEY (id);


--
-- Name: artists artists_handle_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_handle_unique UNIQUE (handle);


--
-- Name: artists artists_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artists
    ADD CONSTRAINT artists_pkey PRIMARY KEY (id);


--
-- Name: drop_products drop_products_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drop_products
    ADD CONSTRAINT drop_products_pkey PRIMARY KEY (drop_id, product_id);


--
-- Name: drops drops_handle_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drops
    ADD CONSTRAINT drops_handle_unique UNIQUE (handle);


--
-- Name: drops drops_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drops
    ADD CONSTRAINT drops_pkey PRIMARY KEY (id);


--
-- Name: entity_media_links entity_media_links_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.entity_media_links
    ADD CONSTRAINT entity_media_links_pkey PRIMARY KEY (id);


--
-- Name: knex_migrations_lock knex_migrations_lock_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.knex_migrations_lock
    ADD CONSTRAINT knex_migrations_lock_pkey PRIMARY KEY (index);


--
-- Name: knex_migrations knex_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.knex_migrations
    ADD CONSTRAINT knex_migrations_pkey PRIMARY KEY (id);


--
-- Name: label_artist_map label_artist_map_label_id_artist_id_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_artist_map
    ADD CONSTRAINT label_artist_map_label_id_artist_id_unique UNIQUE (label_id, artist_id);


--
-- Name: label_artist_map label_artist_map_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_artist_map
    ADD CONSTRAINT label_artist_map_pkey PRIMARY KEY (id);


--
-- Name: label_users_map label_users_map_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_users_map
    ADD CONSTRAINT label_users_map_pkey PRIMARY KEY (id);


--
-- Name: label_users_map label_users_map_user_id_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_users_map
    ADD CONSTRAINT label_users_map_user_id_unique UNIQUE (user_id);


--
-- Name: labels labels_handle_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_handle_unique UNIQUE (handle);


--
-- Name: labels labels_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.labels
    ADD CONSTRAINT labels_pkey PRIMARY KEY (id);


--
-- Name: leads leads_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.leads
    ADD CONSTRAINT leads_pkey PRIMARY KEY (id);


--
-- Name: media_assets media_assets_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.media_assets
    ADD CONSTRAINT media_assets_pkey PRIMARY KEY (id);


--
-- Name: order_events order_events_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_pkey PRIMARY KEY (id);


--
-- Name: order_items order_items_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_pkey PRIMARY KEY (id);


--
-- Name: orders orders_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_pkey PRIMARY KEY (id);


--
-- Name: payment_attempts payment_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_pkey PRIMARY KEY (id);


--
-- Name: payment_events payment_events_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_pkey PRIMARY KEY (id);


--
-- Name: payments payments_order_id_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_unique UNIQUE (order_id);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_pkey PRIMARY KEY (id);


--
-- Name: product_variants product_variants_sku_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_sku_unique UNIQUE (sku);


--
-- Name: products products_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_pkey PRIMARY KEY (id);


--
-- Name: users users_email_unique; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_unique UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: artist_access_requests_created_at_idx; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX artist_access_requests_created_at_idx ON public.artist_access_requests USING btree (created_at);


--
-- Name: artist_access_requests_requestor_user_id_idx; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX artist_access_requests_requestor_user_id_idx ON public.artist_access_requests USING btree (requestor_user_id);


--
-- Name: artist_access_requests_status_idx; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX artist_access_requests_status_idx ON public.artist_access_requests USING btree (status);


--
-- Name: artist_user_map_user_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX artist_user_map_user_id_index ON public.artist_user_map USING btree (user_id);


--
-- Name: artists_handle_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX artists_handle_index ON public.artists USING btree (handle);


--
-- Name: drop_products_drop_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX drop_products_drop_id_index ON public.drop_products USING btree (drop_id);


--
-- Name: drop_products_product_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX drop_products_product_id_index ON public.drop_products USING btree (product_id);


--
-- Name: entity_media_links_avatar_unique; Type: INDEX; Schema: public; Owner: omuser
--

CREATE UNIQUE INDEX entity_media_links_avatar_unique ON public.entity_media_links USING btree (entity_type, entity_id) WHERE (role = 'avatar'::text);


--
-- Name: entity_media_links_cover_unique; Type: INDEX; Schema: public; Owner: omuser
--

CREATE UNIQUE INDEX entity_media_links_cover_unique ON public.entity_media_links USING btree (entity_type, entity_id) WHERE (role = 'cover'::text);


--
-- Name: entity_media_links_gallery_sort_unique; Type: INDEX; Schema: public; Owner: omuser
--

CREATE UNIQUE INDEX entity_media_links_gallery_sort_unique ON public.entity_media_links USING btree (entity_type, entity_id, sort_order) WHERE (role = 'gallery'::text);


--
-- Name: label_artist_map_label_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX label_artist_map_label_id_index ON public.label_artist_map USING btree (label_id);


--
-- Name: label_users_map_label_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX label_users_map_label_id_index ON public.label_users_map USING btree (label_id);


--
-- Name: label_users_map_user_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX label_users_map_user_id_index ON public.label_users_map USING btree (user_id);


--
-- Name: labels_handle_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX labels_handle_index ON public.labels USING btree (handle);


--
-- Name: media_assets_public_url_unique; Type: INDEX; Schema: public; Owner: omuser
--

CREATE UNIQUE INDEX media_assets_public_url_unique ON public.media_assets USING btree (public_url);


--
-- Name: order_events_actor_user_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX order_events_actor_user_id_index ON public.order_events USING btree (actor_user_id);


--
-- Name: order_events_order_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX order_events_order_id_index ON public.order_events USING btree (order_id);


--
-- Name: order_items_order_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX order_items_order_id_index ON public.order_items USING btree (order_id);


--
-- Name: payment_attempts_payment_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX payment_attempts_payment_id_index ON public.payment_attempts USING btree (payment_id);


--
-- Name: payment_events_payment_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX payment_events_payment_id_index ON public.payment_events USING btree (payment_id);


--
-- Name: payment_events_provider_event_unique; Type: INDEX; Schema: public; Owner: omuser
--

CREATE UNIQUE INDEX payment_events_provider_event_unique ON public.payment_events USING btree (provider, provider_event_id) WHERE (provider_event_id IS NOT NULL);


--
-- Name: payment_events_provider_provider_event_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX payment_events_provider_provider_event_id_index ON public.payment_events USING btree (provider, provider_event_id);


--
-- Name: payments_status_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX payments_status_index ON public.payments USING btree (status);


--
-- Name: product_variants_product_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX product_variants_product_id_index ON public.product_variants USING btree (product_id);


--
-- Name: product_variants_sku_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX product_variants_sku_index ON public.product_variants USING btree (sku);


--
-- Name: products_artist_id_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX products_artist_id_index ON public.products USING btree (artist_id);


--
-- Name: products_is_active_index; Type: INDEX; Schema: public; Owner: omuser
--

CREATE INDEX products_is_active_index ON public.products USING btree (is_active);


--
-- Name: artist_access_requests artist_access_requests_decided_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_access_requests
    ADD CONSTRAINT artist_access_requests_decided_by_user_id_foreign FOREIGN KEY (decided_by_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: artist_user_map artist_user_map_artist_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_user_map
    ADD CONSTRAINT artist_user_map_artist_id_foreign FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: artist_user_map artist_user_map_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_user_map
    ADD CONSTRAINT artist_user_map_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: drop_products drop_products_drop_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drop_products
    ADD CONSTRAINT drop_products_drop_id_foreign FOREIGN KEY (drop_id) REFERENCES public.drops(id) ON DELETE CASCADE;


--
-- Name: drop_products drop_products_product_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drop_products
    ADD CONSTRAINT drop_products_product_id_foreign FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: drops drops_artist_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drops
    ADD CONSTRAINT drops_artist_id_foreign FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE SET NULL;


--
-- Name: drops drops_created_by_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drops
    ADD CONSTRAINT drops_created_by_user_id_foreign FOREIGN KEY (created_by_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;


--
-- Name: drops drops_label_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.drops
    ADD CONSTRAINT drops_label_id_foreign FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE SET NULL;


--
-- Name: entity_media_links entity_media_links_media_asset_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.entity_media_links
    ADD CONSTRAINT entity_media_links_media_asset_id_foreign FOREIGN KEY (media_asset_id) REFERENCES public.media_assets(id) ON DELETE CASCADE;


--
-- Name: artist_access_requests fk_artist_access_requests_requestor_user; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.artist_access_requests
    ADD CONSTRAINT fk_artist_access_requests_requestor_user FOREIGN KEY (requestor_user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: label_artist_map label_artist_map_artist_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_artist_map
    ADD CONSTRAINT label_artist_map_artist_id_foreign FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- Name: label_artist_map label_artist_map_label_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_artist_map
    ADD CONSTRAINT label_artist_map_label_id_foreign FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;


--
-- Name: label_users_map label_users_map_label_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_users_map
    ADD CONSTRAINT label_users_map_label_id_foreign FOREIGN KEY (label_id) REFERENCES public.labels(id) ON DELETE CASCADE;


--
-- Name: label_users_map label_users_map_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.label_users_map
    ADD CONSTRAINT label_users_map_user_id_foreign FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: order_events order_events_actor_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_actor_user_id_foreign FOREIGN KEY (actor_user_id) REFERENCES public.users(id);


--
-- Name: order_events order_events_order_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_events
    ADD CONSTRAINT order_events_order_id_foreign FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_order_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_order_id_foreign FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: order_items order_items_product_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_id_foreign FOREIGN KEY (product_id) REFERENCES public.products(id);


--
-- Name: order_items order_items_product_variant_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.order_items
    ADD CONSTRAINT order_items_product_variant_id_foreign FOREIGN KEY (product_variant_id) REFERENCES public.product_variants(id);


--
-- Name: orders orders_buyer_user_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.orders
    ADD CONSTRAINT orders_buyer_user_id_foreign FOREIGN KEY (buyer_user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payment_attempts payment_attempts_payment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payment_attempts
    ADD CONSTRAINT payment_attempts_payment_id_foreign FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: payment_events payment_events_payment_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payment_events
    ADD CONSTRAINT payment_events_payment_id_foreign FOREIGN KEY (payment_id) REFERENCES public.payments(id) ON DELETE CASCADE;


--
-- Name: payments payments_order_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_order_id_foreign FOREIGN KEY (order_id) REFERENCES public.orders(id) ON DELETE CASCADE;


--
-- Name: product_variants product_variants_product_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.product_variants
    ADD CONSTRAINT product_variants_product_id_foreign FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE CASCADE;


--
-- Name: products products_artist_id_foreign; Type: FK CONSTRAINT; Schema: public; Owner: omuser
--

ALTER TABLE ONLY public.products
    ADD CONSTRAINT products_artist_id_foreign FOREIGN KEY (artist_id) REFERENCES public.artists(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--

\unrestrict ewbrurpq4wsRgUXyBSwoUy2oEBiLlwY7uu58SIYvzwJ9iouHhqd8O2RUr0ccVNE

