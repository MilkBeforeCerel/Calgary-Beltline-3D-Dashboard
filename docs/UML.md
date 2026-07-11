# UML — data models and query flow

Two diagrams: a class diagram covering what's actually persisted (and what
deliberately isn't), and a sequence diagram for the natural-language query
→ highlight → save/load flow.

## Class diagram

Only `User` and `Project` are persisted (SQLite, via `backend/app/models.py`).
`Building`, `Permit`, and `QueryOut` are **transient** — fetched fresh from
Calgary Open Data (or mock) on every request and never written to the
database; they're shown here as plain DTOs so the shapes flowing through
the system are documented in one place, not because they live in a table.

```mermaid
classDiagram
    class User {
        +int id
        +string username
        +datetime created_at
    }

    class Project {
        +int id
        +int user_id
        +string name
        +string query_text
        +FilterCondition[] filter_json
        +datetime created_at
        +datetime updated_at
    }

    class FilterCondition {
        <<value object, stored as JSON on Project>>
        +string field
        +string op
        +float|string|string[] value
    }

    User "1" --> "*" Project : owns
    Project "1" *-- "*" FilterCondition : filter_json

    class Building {
        <<transient DTO, never persisted>>
        +string id
        +string address
        +float height_m
        +float[][] footprint
        +float[] centroid
        +string zoning
        +float assessed_value
        +int year_built
        +string land_use
        +float lat
        +float lon
        +string source
    }

    class Permit {
        <<transient DTO, never persisted>>
        +string id
        +string address
        +string permit_type
        +string status
        +float estimated_cost
        +string issued_date
        +float x
        +float y
        +float lat
        +float lon
        +string source
    }

    class QueryOut {
        <<transient DTO, never persisted>>
        +FilterCondition[] conditions
        +string summary
        +string source
    }

    QueryOut "1" *-- "*" FilterCondition : conditions
```

## Sequence diagram

Covers the full loop: typing a query, the LLM turning it into a filter,
the frontend highlighting matches, then optionally saving that filter as a
named project and reloading it later (which skips the LLM entirely).

```mermaid
sequenceDiagram
    actor U as User
    participant QB as QueryBar (React)
    participant API as FastAPI /api/query
    participant LLM as llm_service.interpret_query
    participant Groq as Groq chat/completions
    participant FE as filterEngine.evaluateConditions
    participant Scene as Scene3D (Three.js)
    participant PP as ProjectsPanel (React)
    participant PAPI as FastAPI /api/projects
    participant DB as SQLite (User, Project)

    U->>QB: types "buildings over 100 feet"
    QB->>API: POST /api/query {query_text}
    API->>LLM: interpret_query(query_text)
    LLM->>Groq: chat/completions (system prompt + query, JSON mode)
    Groq-->>LLM: {"conditions":[{field, op, value, unit}], "summary"}
    LLM->>LLM: _convert_units (feet->meters, $ parsing) -- deterministic, not LLM math
    alt LLM unavailable or 0 usable conditions
        LLM->>LLM: _keyword_fallback(query_text)
    end
    LLM-->>API: QueryOut {conditions, summary, source: "llm"|"fallback"}
    API-->>QB: 200 QueryOut
    QB->>FE: evaluateConditions(buildings, conditions)
    FE-->>Scene: matchedIds (Set of building ids)
    Scene->>Scene: recolor matched buildings (highlight > dim others)
    Scene-->>U: highlighted buildings in 3D view

    U->>PP: enters username + project name, clicks "Save"
    PP->>PAPI: POST /api/projects {username, name, query_text, conditions}
    PAPI->>DB: find-or-create User by username
    PAPI->>DB: upsert Project on (user_id, name)
    DB-->>PAPI: Project row
    PAPI-->>PP: ProjectOut
    PP->>PAPI: GET /api/projects?username=... (refresh list)
    PAPI-->>PP: ProjectListOut

    U->>PP: clicks a saved project row
    PP->>FE: evaluateConditions(buildings, project.conditions)
    Note over PP,Groq: loading a saved project never calls the LLM again --<br/>conditions were already resolved at save time
    FE-->>Scene: matchedIds
    Scene-->>U: same highlight reproduced from the saved filter
```
