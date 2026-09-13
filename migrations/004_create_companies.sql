create table companies (
    id serial PRIMARY KEY,
    name VARCHAR(200) NOT NULL, 
    website VARCHAR(300),
    address jsonb,

    created_at TIMESTAMP DEFAULT NOW()
)