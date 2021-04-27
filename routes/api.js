require('dotenv').config();

const express = require("express");
const router = express.Router();
const path = require("path");
const rateLimit = require("express-rate-limit");

const fetch = require("node-fetch");
const jsdom = require("jsdom");
const { JSDOM } = jsdom;

const message_limit = rateLimit({
    windowMs: 24 * 60 * 60 * 1000, // 24 hrs in ms
    max: 100,
    message: "Too many requests, try again later.",
    headers: true,
});

const read_messages_limit = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hr in ms
    max: 100,
    message: "Too many requests, try again later.",
    headers: true,
});

const knex = require("knex")({
    "client": "sqlite3",
    "useNullAsDefault": true,
    "connection": {
        "filename": path.resolve(__dirname, "../assets/db/database.db"),
    },
});

router.use(express.urlencoded({ "extended": false }));
router.use(express.json());

const process_description = (course_title, course_desc) => {
    const metadata = course_title.split(". ");

    const code = metadata[0].match(/^\w{2,4}\s\d{2,3}/ig)[0];
    const credit_hours = metadata[metadata.length - 1];
    const title = metadata.slice(1, -1).join(". ");

    let [CRSSUBJCD, CRSSUBJNBR] = code.split(/\s/);
    CRSSUBJNBR = +CRSSUBJNBR;

    return ({
        "CRSSUBJNBR": CRSSUBJNBR,
        "CRSSUBJCD": CRSSUBJCD,
        "CRSHOURS": credit_hours.trim().replace(".", ""),
        "CRSTITLE": title.trim(),
        "CRSSUBJDESC": course_desc.trim()
    });
};

router.get("/proxy", function(req, res) {
    const {CRSSUBJCD} = req.query;
    const {CRSNBR} = req.query;

    if (!(CRSNBR && CRSSUBJCD)) {
        return res.status(400).json({ "code": 400, "msg": "Malformed request" });
    }

    const url = new URL("https://catalog.uic.edu/ribbit/index.cgi");
    url.searchParams.set("page", "getcourse.rjs");
    url.searchParams.set("code", `${CRSSUBJCD} ${CRSNBR}`);

    fetch(url.toString(), {
        "credentials": "omit",
        "headers": {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:86.0) Gecko/20100101 Firefox/86.0",
            "Accept": "*/*",
            "Accept-Language": "en-US,en;q=0.5",
            "X-Requested-With": "XMLHttpRequest",
        },
        "referrer": "https://catalog.uic.edu/ucat/course-descriptions/cs/",
        "method": "GET",
        "mode": "cors"
    })
    .then(r => r.text())
    .then(course => {
        // Extract HTML from XML
        const html = course.match(/<div.+<\/div>/s)[0];
        const dom = new JSDOM(html);

        // Parse HTML
        const course_title = dom.window.document.querySelector(".courseblocktitle").textContent;
        const course_desc = dom.window.document.querySelector(".courseblockdesc").textContent;

        // Process HTML
        const processed = process_description(course_title, course_desc);
        return res.send(processed);
    })
    .catch(err => res.status(500).json({ "code": 500, "msg": err.code }));
});

router.post("/contact", message_limit, async function(req, res) {
    let db_resp;
    const { name, email, message } = req.body;
    const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;

    try {
        db_resp = await knex("messages").insert({
            "name": name,
            "email": email,
            "message": message,
            "date": (Date.now() * 0.001) | 0,
            "ip_addr": ip,
        });
        return res.send("Message sent successfully!");
    }
    catch (err) {
        return res.status(500).json({ "code": 500, "msg": err.code })
    }
});

router.post("/messages", read_messages_limit, function(req, res) {
    const { password } = req.body;

    if (password === process.env.DB_PASS) {
        const query = knex("messages");
        query.orderBy("date", "desc");

        query.then(results => {
            return res.send(results);
        })
        .then(null, err => res.status(500).json({ "code": 500, "msg": err.code }));
    }
    else {
        return res.status(403).json({ "code": 403, "msg": "Forbidden" });
    }
});

router.get("/class", function(req, res) {
    const query = knex("grades");

    query.select("CRSSUBJCD", "CRSNBR", "CRSTITLE", "DEPTNAME", "PrimaryInstructor", "DEPTCD", "A", "B", "C", "D", "F", "W", "SEASON", "YEAR");
    query.select(knex.raw("ROUND((((A*4.0) + (B*3.0) + (C*2.0) + (D*1.0))/((A+B+C+D+F)*4.0))*4.0, 2) AS avg_gpa"));

    const department = req.query.department || null;
    const department_name = req.query.department_name || null;
    const course_number = req.query.course_number || null;
    const course_title = req.query.course_title || null;
    const instructor = req.query.instructor || null;
    const season = req.query.season || null;
    const year = req.query.year || null;

    if (department) {
        query.where({ "CRSSUBJCD": department });
    }
    if (course_number) {
        query.where({ "CRSNBR": course_number });
    }
    if (course_title) {
        query.where({ "CRSTITLE": course_title });
    }
    if (season) {
        query.where({ "SEASON": season });
    }
    if (year) {
        query.where({ "YEAR": year });
    }
    if (department_name) {
        query.whereRaw("DEPTNAME LIKE ?", department_name);
    }
    if (instructor) {
        query.whereRaw("PrimaryInstructor LIKE ?", instructor);
    }

    query.then(results => {

        if (results.length > 0) {
            const { DEPTCD, CRSNBR, PrimaryInstructor } = results[0];

            // Query similar courses
            const sub_query = knex("grades");
            sub_query.select("CRSNBR", "CRSSUBJCD", "CRSTITLE", "PrimaryInstructor", "SEASON", "YEAR");
            sub_query.select(knex.raw("ROUND((((A*4.0) + (B*3.0) + (C*2.0) + (D*1.0))/((A+B+C+D+F)*4.0))*4.0, 2) AS avg_gpa"));
            sub_query.select(knex.raw("(DEPTCD || '-' || CRSNBR) AS computed_id"));
            sub_query.where("DEPTCD", DEPTCD);
            sub_query.where("CRSNBR", ">=", CRSNBR);
            sub_query.whereNot("PrimaryInstructor", PrimaryInstructor);
            sub_query.orderBy("computed_id", "asc");
            sub_query.limit(3);

            sub_query.then(second_results => res.send({
                ...results[0],
                "similar_class": second_results,
            }))
            .then(null, err => res.status(500).json({ "code": 500, "msg": err.code }));
        }
        else {
            return res.status(404).json({ "code": 404, "msg": "Not Found" });
        }
    })
    .then(null, err => res.status(500).json({ "code": 500, "msg": err.code }));
});

router.get("/classes", function(req, res) {
    const query = knex("grades");
    query.select("CRSSUBJCD", "CRSNBR", "CRSTITLE", "DEPTNAME", "PrimaryInstructor", "SEASON", "YEAR");
    query.select(knex.raw("ROUND((((A*4.0) + (B*3.0) + (C*2.0) + (D*1.0))/((A+B+C+D+F)*4.0))*4.0, 2) AS avg_gpa"));

    const department = req.query.department || null;
    const department_name = req.query.department_name || null;
    const course_number = req.query.course_number || null;
    const course_title = req.query.course_title || null;
    const instructor = req.query.instructor || null;
    const limit = +req.query.limit || null;
    const order_by = req.query.order_by || null;
    const sort = req.query.sort || null;

    if (order_by) {
        query.orderBy(order_by, sort || "asc");
    }
    if (limit) {
        query.limit(limit);
    }
    if (department) {
        query.where({ "CRSSUBJCD": department });
    }
    if (course_number) {
        query.where({ "CRSNBR": course_number });
    }
    if (course_title) {
        query.where({ "CRSTITLE": course_title });
    }
    if (department_name) {
        query.whereRaw("DEPTNAME LIKE ?", department_name);
    }
    if (instructor) {
        query.whereRaw("PrimaryInstructor LIKE ?", instructor);
    }

    query.then(results => {
        res.send(results);
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code })
    });
});

router.get("/course_info", function(req, res) {
    const query = knex("courses");
    query.select("CRSNBR", "CRSSUBJCD", "CRSHOURS", "CRSTITLE", "CRSSUBJDESC");

    const department = req.query.department || null;
    const course_number = req.query.course_number || null;

    if (department) {
        query.where({ "CRSSUBJCD": department });
    }
    else {
        return res.status(400).json({ "code": 400, "msg": "Bad Request" });
    }

    if (course_number) {
        query.where({ "CRSNBR": course_number });
    }
    else {
        return res.status(400).json({ "code": 400, "msg": "Bad Request" });
    }

    query.then(results => {
        if (results.length > 0) {
            return res.send(results[0]);
        }
        else {
            return res.status(404).json({ "code": 404, "msg": "Not Found" });
        }
    })
    .then(null, err => res.status(500).json({ "code": 500, "msg": err.code }));
});

router.get("/courses", function(req, res) {
    const query = knex("grades");
    query.select(knex.raw("CRSSUBJCD || ' ' || CRSNBR AS CODE"));
    query.select("CRSTITLE", "DEPTNAME", "CRSSUBJCD", "CRSNBR");
    query.count("*", { "as": "CLASSCOUNT" });
    query.groupBy("CODE");

    const department = req.query.department || null;
    const department_name = req.query.department_name || null;
    const course_number = req.query.course_number || null;
    const course_title = req.query.course_title || null;
    const instructor = req.query.instructor || null;
    const limit = +req.query.limit || null;

    const order_by = req.query.order_by || null;
    const sort = req.query.sort || null;

    if (order_by) {
        query.orderBy(order_by, sort || "asc");
    }
    if (limit) {
        query.limit(limit);
    }
    if (department) {
        query.where({ "CRSSUBJCD": department });
    }
    if (course_number) {
        query.where({ "CRSNBR": course_number });
    }
    if (course_title) {
        query.where({ "CRSTITLE": course_title });
    }
    if (department_name) {
        query.where("DEPTNAME", "LIKE", department_name);
    }
    if (instructor) {
        query.where("PrimaryInstructor", "LIKE", instructor);
    }

    if (order_by) {
        query.orderBy(order_by, sort || "asc");
    }

    query.then(results => {
        return res.send(results);
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});

router.get("/department/:deptCode", function(req, res) {
    const { deptCode } = req.params;

    // Protect against SQL injection
    if (!deptCode.match(/^[A-Z]{2,4}$/i)) {
        return res.status(400).json({ "code": 400, "msg": "Invalid department" });
    }

    const query = knex.raw(`
        SELECT a.CRSSUBJCD, a.CRSNBR, a.CRSTITLE, a.CODE, CLASSCOUNT FROM
        (SELECT CRSSUBJCD, CRSNBR, CRSTITLE, CRSSUBJCD || ' ' || CRSNBR AS CODE
        FROM courses
        WHERE CRSSUBJCD LIKE ?
        ORDER BY CRSNBR) as A
        LEFT JOIN
        (SELECT CRSSUBJCD || ' ' || CRSNBR as CODE, CRSSUBJCD, CRSNBR, COUNT(*) as CLASSCOUNT
        from grades
        where CRSSUBJCD LIKE ?
        group by CODE) as b
        USING (CODE)
    `, [deptCode, deptCode]);

    query.then(results => {
        if (results.length > 0) {
            return res.send(results);
        }
        else {
            return res.status(404).json({ "code": 404, "msg": "Not Found" });
        }
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});

router.get("/instructor/:PrimaryInstructor", (req, res) => {
    const { PrimaryInstructor } = req.params;
    const compare = +req.query.compare;

    const query = knex("grades");
    query.select("PrimaryInstructor");
    query.select(knex.raw("ROUND((((SUM(D)+SUM(F)+SUM(W))*1.0)/((SUM(A)+SUM(B)+SUM(C)+SUM(D)+SUM(F)+SUM(w))*1.0))*100.0,2) AS dfw_rate"));
    query.select(knex.raw("ROUND((((SUM(A)*4.0)+(SUM(B)*3.0)+(SUM(C)*2.0)+(SUM(D)*1.0)+(SUM(F)*0.0))/((SUM(A)+SUM(B)+SUM(C)+SUM(D)+SUM(F)))),2) as avg_gpa"));

    if (compare) {
        query.sum("A as A");
        query.sum("B as B");
        query.sum("C as C");
        query.sum("D as D");
        query.sum("F as F");
        query.sum("W as W");
    }

    // Exclude classes where instructor didn't submit grades on time
    query.whereRaw("NR <> GradeRegs");
    query.whereRaw("NR+W <> GradeRegs");

    query.groupBy("PrimaryInstructor");
    query.where({ "PrimaryInstructor": PrimaryInstructor });

    query.then(results => {
        if (results.length > 0) {
            return res.send(results[0]);
        }
        else {
            return res.status(404).json({ "code": 404, "msg": "Not Found" });
        }
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});

router.get("/departments", function(req, res) {
    const query = knex("courses");
    query.select("CRSSUBJCD");
    query.select("DEPTNAME");
    query.count("*", { "as": "num_courses" });
    query.joinRaw("JOIN departments USING(CRSSUBJCD)");
    query.groupBy("DEPTNAME");

    const order_by = req.query.order_by || null;
    const sort = req.query.sort || null;

    if (order_by) {
        query.orderBy(order_by, sort || "asc");
    }

    query.then(results => {
        return res.send(results);
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});

router.get("/instructors/:letter", function(req, res) {
    const { letter } = req.params;
    const search = +req.query.search;
    const limit = +req.query.limit;

    const query = knex("instructor_fts");
    query.select(knex.raw("instructor as PrimaryInstructor"));

    if (limit) {
        query.limit(limit);
    }

    if (search) {
        query.where("PrimaryInstructor", "MATCH", `${letter}*`);
    }
    else {
        query.where("PrimaryInstructor", "MATCH", `^${letter}*`);
    }

    query.then(results => {
        return res.send(results);
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});

router.get("/search/:searchQuery", function(req, res) {
    const { searchQuery } = req.params;

    const query = knex("course_fts");
    query.select(knex.raw("highlight(course_fts,0,'<b>','</b>') CRSSUBJCD"));
    query.select(knex.raw("highlight(course_fts,1,'<b>','</b>') CRSNBR"));
    query.select(knex.raw("highlight(course_fts,2,'<b>','</b>') CRSTITLE"));
    query.select(knex.raw("highlight(course_fts,3,'<b>','</b>') CLASSTITLE"));
    query.where("course_fts", "MATCH", `${searchQuery}*`);
    query.orderBy(knex.raw("bm25(course_fts, 10.0, 10.0, 5.0, 5.0, 10.0)"));
    query.limit(10);

    query.then(results => {
        return res.send(results);
    })
    .then(null, err => {
        return res.status(500).json({ "code": 500, "msg": err.code });
    });
});


module.exports = router;
