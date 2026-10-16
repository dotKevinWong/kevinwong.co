--
-- PostgreSQL database dump
--


-- Dumped from database version 17.11 (59c914d)
-- Dumped by pg_dump version 17.11 (Debian 17.11-1.pgdg13+2)

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--



--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


--
-- Name: media_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.media_kind AS ENUM (
    'image',
    'video'
);


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: instagram_media; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram_media (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    post_id uuid NOT NULL,
    "position" integer NOT NULL,
    kind public.media_kind NOT NULL,
    cloudinary_public_id text NOT NULL,
    cloudinary_url text NOT NULL,
    cloudinary_version integer,
    cloudinary_resource_type text,
    cloudinary_format text,
    cloudinary_width integer,
    cloudinary_height integer,
    cloudinary_duration numeric,
    cloudinary_folder text NOT NULL,
    file_ext text NOT NULL,
    source_uri text NOT NULL,
    source_created_at timestamp with time zone NOT NULL,
    raw_media_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    asset_url text,
    asset_pathname text,
    asset_content_type text,
    asset_bytes bigint,
    asset_width integer,
    asset_height integer,
    CONSTRAINT instagram_media_position_check CHECK (("position" >= 0))
);


--
-- Name: instagram_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.instagram_posts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_key text NOT NULL,
    caption text DEFAULT ''::text NOT NULL,
    instagram_url text,
    posted_at timestamp with time zone NOT NULL,
    raw_post_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    caption_emojis text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: integration_tokens; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_tokens (
    provider text NOT NULL,
    access_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    refreshed_at timestamp with time zone DEFAULT now() NOT NULL,
    dead_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at_is_assumed boolean DEFAULT false NOT NULL
);


--
-- Name: job_locks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.job_locks (
    name text NOT NULL,
    locked_until timestamp with time zone DEFAULT '1970-01-01 00:00:00+00'::timestamp with time zone NOT NULL
);


--
-- Name: instagram_media instagram_media_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_pkey PRIMARY KEY (id);


--
-- Name: instagram_media instagram_media_post_id_position_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_post_id_position_key UNIQUE (post_id, "position");


--
-- Name: instagram_posts instagram_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_posts
    ADD CONSTRAINT instagram_posts_pkey PRIMARY KEY (id);


--
-- Name: instagram_posts instagram_posts_source_key_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_posts
    ADD CONSTRAINT instagram_posts_source_key_key UNIQUE (source_key);


--
-- Name: integration_tokens integration_tokens_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_tokens
    ADD CONSTRAINT integration_tokens_pkey PRIMARY KEY (provider);


--
-- Name: job_locks job_locks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.job_locks
    ADD CONSTRAINT job_locks_pkey PRIMARY KEY (name);


--
-- Name: instagram_media_cloudinary_public_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instagram_media_cloudinary_public_id_idx ON public.instagram_media USING btree (cloudinary_public_id);


--
-- Name: instagram_media_post_id_position_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instagram_media_post_id_position_idx ON public.instagram_media USING btree (post_id, "position");


--
-- Name: instagram_posts_posted_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX instagram_posts_posted_at_idx ON public.instagram_posts USING btree (posted_at DESC);


--
-- Name: instagram_media instagram_media_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.instagram_media
    ADD CONSTRAINT instagram_media_post_id_fkey FOREIGN KEY (post_id) REFERENCES public.instagram_posts(id) ON DELETE CASCADE;


--
-- PostgreSQL database dump complete
--


