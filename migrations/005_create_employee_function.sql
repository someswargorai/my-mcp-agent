CREATE OR REPLACE FUNCTION create_employee(
    p_name TEXT,
    p_email TEXT,
    p_salary NUMERIC
)
RETURNS INTEGER
AS $$
DECLARE
    new_employee_id INTEGER;
BEGIN
    INSERT INTO employees (name, email, salary)
    VALUES (p_name, p_email, p_salary)
    RETURNING id INTO new_employee_id;

    RETURN new_employee_id;
END;
$$ LANGUAGE plpgsql;