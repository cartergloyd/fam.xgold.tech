-- Trip and property content for the family home page. Additive: nothing is dropped.
-- Apply as the fam owner, then restart family Directus so it sees the new columns.
BEGIN;

-- Properties gain the house details the home page used to hardcode.
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'family' CHECK (kind IN ('family','rental'));
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS address text NOT NULL DEFAULT '';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS bedrooms integer CHECK (bedrooms BETWEEN 0 AND 100);
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS bathrooms integer CHECK (bathrooms BETWEEN 0 AND 100);
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS sleeps integer CHECK (sleeps BETWEEN 0 AND 200);
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS spaces jsonb NOT NULL DEFAULT '[]';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS amenities jsonb NOT NULL DEFAULT '[]';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS nearby jsonb NOT NULL DEFAULT '[]';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS hero jsonb NOT NULL DEFAULT '[]';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS gallery jsonb NOT NULL DEFAULT '[]';
ALTER TABLE family_properties ADD COLUMN IF NOT EXISTS cards jsonb NOT NULL DEFAULT '{}';

INSERT INTO family_properties(id,title,description,house_rules,check_in,check_out,timezone,kind,address,bedrooms,bathrooms,sleeps,spaces,amenities,nearby,hero,gallery,cards)
VALUES ('seastar-palazzo','Seastar Palazzo','','','16:00','10:00','America/Chicago','rental','3491 Scenic Highway 98, Destin, FL 32541',9,9,22,
 '["Balcony","Kitchen","Deck/patio","Kitchenette","Dining area","Living room"]',
 '["Private pool","Outdoor grill with bar seating","Gulf views from the living room","Elevator","Washer and dryer","Pet friendly"]',
 '["Miramar Beach · 5 min walk","James Lee Park · 5 min walk","James Lee Beach · 5 min walk","Northwest Florida Regional Airport (VPS) · 34 min drive"]',
 '[{"image":"/photos/seastar-palazzo/hero-1.webp","position":"50% 62%","mobile_position":"66% 50%"},
   {"image":"/photos/seastar-palazzo/hero-2.webp","position":"50% 55%","mobile_position":"50% 50%"}]',
 '[{"image":"/photos/seastar-palazzo/hero-1.webp","alt":"Three-story stucco house at sunset with a lit pool, gazebo and spiral staircase","caption":"Sunset from the pool deck"},
   {"image":"/photos/seastar-palazzo/hero-2.webp","alt":"Front of the three-story house with balconies, palm trees, a pool and outdoor kitchen","caption":"Balconies, gazebo and outdoor kitchen"},
   {"image":"/photos/seastar-palazzo/house-1.webp","alt":"Kitchen with a large granite island, bar stools and pendant lights","caption":"The kitchen island"},
   {"image":"/photos/seastar-palazzo/house-2.webp","alt":"Kitchen sink and dishwashers beside the staircase, with the dining area beyond","caption":"Kitchen, stairs and dining area"},
   {"image":"/photos/seastar-palazzo/house-3.webp","alt":"Living room with a leather sectional and windows looking out to the Gulf","caption":"Living room with Gulf views"},
   {"image":"/photos/seastar-palazzo/house-4.webp","alt":"Sitting area with a green sofa and sliding doors to the pool","caption":"Sitting area by the pool doors"},
   {"image":"/photos/seastar-palazzo/house-5.webp","alt":"Bright living room with a sectional, armchairs and ocean-view windows","caption":"Living room"},
   {"image":"/photos/seastar-palazzo/house-6.webp","alt":"Living room with a built-in TV cabinet and the dining table behind","caption":"Living room and dining table"},
   {"image":"/photos/seastar-palazzo/house-7.webp","alt":"Outdoor kitchen under a wooden gazebo with a grill, bar seating and a TV at sunset","caption":"Outdoor kitchen at sunset"},
   {"image":"/photos/seastar-palazzo/house-8.webp","alt":"Balcony with a railing overlooking the pool and a lake","caption":"Balcony over the pool and lake"},
   {"image":"/photos/seastar-palazzo/house-9.webp","alt":"Three-story house with a long pool, lounge chairs and a gazebo","caption":"The pool and gazebo"}]',
 '{"flights":{"image":"/photos/seastar-palazzo/card-flights.webp"},
   "rooms":{"image":"/photos/seastar-palazzo/card-rooms.webp","alt":"Bedroom with a king bed, Gulf views and a balcony"},
   "area":{"headline":"Walk to the beach.","image":"/photos/seastar-palazzo/card-map.webp","alt":"Map of 3491 Scenic Highway 98, Destin, with the beach and Gulf just across the road",
           "pins":[{"icon":"home","x":49.3,"y":40},{"icon":"beach","x":34,"y":74.7},{"icon":"water","x":21,"y":90.7}]},
   "amenities":{"headline":"Check out the pool, gazebo and outdoor kitchen.","image":"/photos/seastar-palazzo/card-amenities.webp","alt":"House with a private pool and a gazebo with an outdoor kitchen",
           "pins":[{"icon":"gazebo","x":18,"y":63},{"icon":"pool","x":50,"y":86}]}}')
ON CONFLICT (id) DO NOTHING;

-- Bedrooms a property offers. slug matches the kv bedroom document id (b1…).
CREATE TABLE IF NOT EXISTS family_rooms (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 property_id text NOT NULL REFERENCES family_properties(id),
 slug text NOT NULL CHECK (slug ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 sort integer NOT NULL DEFAULT 0,
 name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
 photos jsonb NOT NULL DEFAULT '[]',
 UNIQUE(property_id,slug)
);
INSERT INTO family_rooms(property_id,slug,sort,name,photos) VALUES
 ('seastar-palazzo','b1',1,'King Bedroom With Private Bathroom On 1st Floor','["/photos/seastar-palazzo/b1-1.webp","/photos/seastar-palazzo/b1-2.webp","/photos/seastar-palazzo/b1-3.webp","/photos/seastar-palazzo/b1-4.webp"]'),
 ('seastar-palazzo','b2',2,'Guest Bedroom With Four Queen Beds On 1st Floor #1','["/photos/seastar-palazzo/b2-1.webp","/photos/seastar-palazzo/b2-2.webp"]'),
 ('seastar-palazzo','b3',3,'Guest Bedroom With Four Queen Beds On 1st Floor #2','["/photos/seastar-palazzo/b3-1.webp","/photos/seastar-palazzo/b3-2.webp"]'),
 ('seastar-palazzo','b4',4,'King Bedroom With Bathroom On 2nd Floor','["/photos/seastar-palazzo/b4-1.webp","/photos/seastar-palazzo/b4-2.webp"]'),
 ('seastar-palazzo','b5',5,'Queen Bedroom With Bathroom On 2nd Floor','["/photos/seastar-palazzo/b5-1.webp","/photos/seastar-palazzo/b5-2.webp"]'),
 ('seastar-palazzo','b6',6,'King Bedroom With Bathroom On 3rd Floor','["/photos/seastar-palazzo/b6-1.webp","/photos/seastar-palazzo/b6-2.webp"]'),
 ('seastar-palazzo','b7',7,'Primary King Bedroom With Bathroom On 3rd Floor','["/photos/seastar-palazzo/b7-1.webp","/photos/seastar-palazzo/b7-2.webp","/photos/seastar-palazzo/b7-3.webp"]'),
 ('seastar-palazzo','b8',8,'Primary King Bedroom With Bathroom 3rd Floor','["/photos/seastar-palazzo/b8-1.webp","/photos/seastar-palazzo/b8-2.webp"]'),
 ('seastar-palazzo','b9',9,'King Bedroom With Private Bathroom On 3rd Floor','["/photos/seastar-palazzo/b9-1.webp"]')
ON CONFLICT (property_id,slug) DO NOTHING;

-- Trips. The home page features the trip in progress or the next one to start.
CREATE TABLE IF NOT EXISTS family_trips (
 id text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
 property_id text NOT NULL REFERENCES family_properties(id),
 title text NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
 start_date date NOT NULL, end_date date NOT NULL,
 origin_airport text CHECK (origin_airport ~ '^[A-Z]{3}$'),
 local_airports jsonb NOT NULL DEFAULT '[]',
 driver_id uuid REFERENCES family_users(id),
 tagline text NOT NULL DEFAULT '' CHECK (length(tagline) <= 200),
 countdown text NOT NULL DEFAULT 'the trip' CHECK (length(countdown) BETWEEN 1 AND 60),
 revision integer NOT NULL DEFAULT 1,
 CHECK (end_date > start_date), CHECK (end_date - start_date <= 60)
);
INSERT INTO family_trips(id,property_id,title,start_date,end_date,origin_airport,local_airports,driver_id,tagline,countdown)
SELECT 'destin-2027','seastar-palazzo','Spring Break ''27: Destin, Florida','2027-03-28','2027-04-04','STL','["VPS","ECP","PNS"]',
       (SELECT id FROM family_users WHERE name='Jaime' ORDER BY name LIMIT 1),'Seven nights of sun, sand and family.','the beach'
ON CONFLICT (id) DO NOTHING;

-- Trip documents carry their trip. Fixed ids (bedrooms/b1, progress/Name, meals/day-slot) are
-- prefixed "trip:" so a later trip can reuse them; the site adds and strips the prefix.
ALTER TABLE kv ADD COLUMN IF NOT EXISTS trip text;
UPDATE kv SET trip='destin-2027' WHERE trip IS NULL;
ALTER TABLE kv ALTER COLUMN trip SET DEFAULT 'destin-2027';
ALTER TABLE kv ALTER COLUMN trip SET NOT NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='kv'::regclass AND conname='kv_trip_fkey') THEN
    ALTER TABLE kv ADD CONSTRAINT kv_trip_fkey FOREIGN KEY (trip) REFERENCES family_trips(id);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS kv_trip_coll_idx ON kv(trip,coll);
INSERT INTO kv(key,coll,id,data,trip)
 SELECT coll||'/destin-2027:'||id, coll, 'destin-2027:'||id, data, 'destin-2027' FROM kv
 WHERE coll IN ('plans','bedrooms','flights','progress','meals','groceries') AND id NOT LIKE 'destin-2027:%'
ON CONFLICT DO NOTHING;
DELETE FROM kv k WHERE k.coll IN ('plans','bedrooms','flights','progress','meals','groceries') AND k.id NOT LIKE 'destin-2027:%'
 AND EXISTS (SELECT 1 FROM kv p WHERE p.coll=k.coll AND p.id='destin-2027:'||k.id);

ALTER TABLE family_rooms OWNER TO fam;
ALTER TABLE family_trips OWNER TO fam;

-- Directus admin metadata. Public access stays with the read-only /family/trip endpoint.
INSERT INTO directus_collections(collection,icon,note,display_template) VALUES
 ('family_trips','flight_takeoff','Family trips shown on the home page. The trip in progress or next to start is featured.','{{title}}'),
 ('family_rooms','bed','Bedrooms a property offers for claiming. slug matches the kv bedroom id (b1…).','{{name}}')
ON CONFLICT (collection) DO NOTHING;
UPDATE directus_collections SET note='Condo and trip-house details. Managed by Carter and Chester.' WHERE collection='family_properties';
INSERT INTO directus_fields(collection,field,interface,options,note)
SELECT v.collection,v.field,v.interface,v.options::json,v.note FROM (VALUES
 ('kv','trip','input',NULL,'Trip id. Fixed document ids are prefixed "trip:".'),
 ('family_properties','spaces','input-code','{"language":"json"}','JSON list of strings'),
 ('family_properties','amenities','input-code','{"language":"json"}','JSON list of strings'),
 ('family_properties','nearby','input-code','{"language":"json"}','JSON list of strings, e.g. "Miramar Beach · 5 min walk"'),
 ('family_properties','hero','input-code','{"language":"json"}','JSON list of {image, position, mobile_position} for the home page slideshow'),
 ('family_properties','gallery','input-code','{"language":"json"}','JSON list of {image, alt, caption}'),
 ('family_properties','cards','input-code','{"language":"json"}','JSON {flights, rooms, area, amenities} with image, alt, headline and pins [{icon,x,y}]; icons: home, beach, water, gazebo, pool'),
 ('family_rooms','photos','input-code','{"language":"json"}','JSON list of image URLs'),
 ('family_trips','local_airports','input-code','{"language":"json"}','JSON list of IATA codes; the first is the default arrival airport')
) v(collection,field,interface,options,note)
WHERE NOT EXISTS (SELECT 1 FROM directus_fields d WHERE d.collection=v.collection AND d.field=v.field);
COMMIT;
