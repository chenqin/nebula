/*
 * Copyright 2017-present Shawn Cao
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
    NebulaClient
} from "/dist/web/main.js";

import {
    Nebula,
    count,
    sum,
    min,
    max,
    avg,
    tree,
    p10,
    p25,
    p50,
    p75,
    p90,
    p99,
    p99_9,
    p99_99
} from './sdk.min.js';

import {
    Charts
} from "/c/charts.min.js";

import {
    Constraints
} from "/c/constraints.min.js";

// define jquery style selector 
const ds = NebulaClient.d3.select;
const $$ = (e) => $(e).val();

// global value represents current data set
let json = [];

// two calendar instances
let fpcs, fpce;

// TODO(cao): this has assumption web server living together with nebula server/envoy
// before we replace "{SERVER-ADDRESS}" in build phase, not good for docker image repo
const serviceAddr = `${window.location.protocol}//${window.location.hostname}:8080`;
const v1Client = new NebulaClient.V1Client(serviceAddr);
const timeCol = "_time_";
const charts = new Charts();
const nebula = new Nebula();
const formatTime = charts.formatTime;
const log = console.log;
const msg = (text) => ds('#qr').text(text);

// arch mode indicates the web architecture mode
// 1: v1 - web client will query nebula server directly
// 2: v2 - web client will query nebula server through web API. 
// In mode 2, we will need only single place for OAuth which is web (80).
// and potentially close 8080 to public.
let archMode = 2;

// filters
let filters;

// a pointer to latest dimensions selectize
let $sdc = null;

const onTableState = (state, stats, callback) => {
    const bc = state.bc;
    const rc = Math.round(state.rc / 10000) / 100;
    const ms = Math.round(state.ms / 10000000) / 100;
    const mints = formatTime(state.mt * 1000);
    const maxts = formatTime(state.xt * 1000 + 1);

    stats.text(`[Blocks: ${bc}, Rows: ${rc}M, Mem: ${ms}GB, Min T: ${mints}, Max T: ${maxts}]`);

    fpcs = $("#start").flatpickr({
        enableTime: true,
        allowInput: true,
        clickOpens: false,
        dateFormat: "Y-m-d H:i:S",
        defaultDate: mints,
        minDate: mints,
        maxDate: maxts
    });
    // hook calendar click event
    $('#startc').on("click", () => {
        fpcs.open();
    });

    fpce = $("#end").flatpickr({
        enableTime: true,
        allowInput: true,
        clickOpens: false,
        dateFormat: "Y-m-d H:i:S",
        defaultDate: maxts,
        minDate: mints,
        maxDate: maxts
    });
    // hook calendar click event
    $('#endc').on("click", () => {
        fpce.open();
    });

    // populate dimension columns
    const dimensions = (state.dl || []).filter((v) => v !== timeCol);
    let metrics = (state.ml || []).filter((v) => v !== timeCol);
    const all = dimensions.concat(metrics);
    let rollups = Object.keys(NebulaClient.Rollup);

    $('#dwrapper').html("<select id=\"dcolumns\" multiple></select>");
    ds('#dcolumns')
        .html("")
        .selectAll("option")
        .data(all)
        .enter()
        .append('option')
        .text(d => d)
        .attr("value", d => d);
    $sdc = $('#dcolumns').selectize({
        plugins: ['restore_on_backspace', 'remove_button'],
        persist: false
    });

    // // if the table has no metrics column (no value columns)
    // // we only allow count on first column then
    // if (metrics.length == 0) {
    //     metrics = [dimensions[0]];
    //     rollups = ['COUNT'];
    // }

    // populate metrics columns
    const setm = (values) =>
        ds('#mcolumns')
        .html("")
        .selectAll("option")
        .data(values)
        .enter()
        .append('option')
        .text(d => d)
        .attr("value", d => d);
    setm(all);

    // populate all display types
    ds('#display')
        .html("")
        .selectAll("option")
        .data(Object.keys(NebulaClient.DisplayType))
        .enter()
        .append('option')
        .text(k => k.toLowerCase())
        .attr("value", k => NebulaClient.DisplayType[k]);

    // roll up methods
    ds('#ru')
        .html("")
        .selectAll("option")
        .data(rollups)
        .enter()
        .append('option')
        .text(k => k.toLowerCase())
        .attr("value", k => NebulaClient.Rollup[k]);

    // when rollup method changed to methods that support dimenions
    // we can refresh metrics colummn
    // if user change the table selection, initialize it again
    // ds('#ru').on('change', () => {
    //     const v = $$('#ru');
    //     if (v === proto.nebula.service.Rollup.TREEMERGE.toString()) {
    //         setm(all);
    //     } else {
    //         setm(metrics);
    //     }
    // });

    // order type 
    ds('#ob')
        .html("")
        .selectAll("option")
        .data(Object.keys(NebulaClient.OrderType))
        .enter()
        .append('option')
        .text(k => k.toLowerCase())
        .attr("value", k => NebulaClient.OrderType[k]);

    if (callback) {
        callback(all);
    }
};

const initTable = (table, callback) => {
    const stats = ds('#stats');
    if (archMode === 1) {
        const req = new NebulaClient.TableStateRequest();
        req.setTable(table);

        // call the service 
        v1Client.state(req, {}, (err, reply) => {

            if (err !== null) {
                stats.text("Error code: " + err);
            } else if (reply == null) {
                stats.text("Failed to get reply");
            } else {
                onTableState({
                    bc: reply.getBlockcount(),
                    rc: reply.getRowcount(),
                    ms: reply.getMemsize(),
                    mt: reply.getMintime(),
                    xt: reply.getMaxtime(),
                    dl: reply.getDimensionList(),
                    ml: reply.getMetricList()
                }, stats, callback);
            }
        });
    } else if (archMode === 2) {
        // table name may have special characters, so encode the table name
        $.ajax({
            url: "/?api=state&start=0&end=0&table=" + encodeURIComponent(table)
        }).fail((err) => {
            stats.text("Error: " + err);
        }).done((data) => {
            onTableState(data, stats, callback);
        });
    }
};

// make another query, with time[1548979200 = 02/01/2019, 1556668800 = 05/01/2019] 
// place basic check before sending to server
// return true if failed the check
const checkRequest = (state) => {
    // 1. timeline query
    const display = state.display;
    if (display == NebulaClient.DisplayType.TIMELINE) {
        const windowSize = state.window;
        // window size == 0: auto
        if (windowSize > 0) {
            const rangeSeconds = (state.end - state.start) / 1000;
            const buckets = rangeSeconds / windowSize;
            if (buckets > 1000) {
                msg(`Too many data points to return ${buckets}, please increase window granularity.`);
                return true;
            }
        }
    }

    if (display == NebulaClient.DisplayType.SAMPLES) {
        // TODO(cao) - support * when user doesn't select any dimemsions
        if (state.keys.length == 0) {
            msg(`Please specify dimensions for samples`);
            return true;
        }
    }

    // pass the check
    return false;
};

const hash = (v) => {
    if (v) {
        window.location.hash = v;
    }

    return window.location.hash;
};

const build = (s) => {
    // build URL and set URL
    const state = s || {
        table: $$('#tables'),
        start: $$('#start'),
        end: $$('#end'),
        filter: filters.expr(),
        keys: $$('#dcolumns'),
        window: $$("#window"),
        display: $$('#display'),
        metrics: $$('#mcolumns'),
        rollup: $$('#ru'),
        sort: $$('#ob'),
        limit: $$('#limit')
    };

    if (!state.start || !state.end) {
        alert('please enter start and end time');
        return;
    }

    // change hash will trigger query
    hash('#' + encodeURIComponent(JSON.stringify(state)));
};

const restore = () => {
    // if no hash value - use the first table as the hash
    let h = hash();
    if (!h || h.length < 10) {
        const tb = $$('#tables');
        h = `?{"table": "${tb}"}`;
    }

    // get parameters from URL
    const state = JSON.parse(decodeURIComponent(h.substr(1)));
    const set = (N, V) => ds(N).property('value', V);
    const table = state.table;
    if (table) {
        set('#tables', table);
        initTable(table, (cols) => {
            // set other fields
            set('#start', state.start);
            set('#end', state.end);
            set("#window", state.window);
            set('#display', state.display);
            set('#mcolumns', state.metrics);
            set('#ru', state.rollup);
            set('#ob', state.sort);
            set('#limit', state.limit);

            // set value of dimensions if there is one
            if ($sdc && state.keys) {
                $sdc[0].selectize.setValue(state.keys);
            }

            // populate all operations
            const om = {
                EQ: "=",
                NEQ: "!=",
                MORE: ">",
                LESS: "<",
                LIKE: "like",
                ILIKE: "ilike"
            };

            const ops = {};
            for (var k in NebulaClient.Operation) {
                ops[NebulaClient.Operation[k]] = om[k];
            }

            // TODO(cao): due to protobuf definition, we can't build nested group.
            // Should update to support it, then we can turn this flag to true
            // create a filter
            filters = new Constraints(false, "filters", cols, ops, state.filter);

            // if code is specified, set code content and switch to IDE
            if (state.code && state.code.length > 0) {
                editor.setValue(state.code);
                ide();
            }

            // the URL needs to be executed
            execute();
        });
    }
};

const seconds = (ds) => Math.round(new Date(ds).getTime() / 1000);

// extract X-Y for line charts based on json result and query object
const extractXY = (json, state) => {
    // extract X-Y (dimension - metric) columns to display
    // TODO(cao) - revisit this if there are multiple X or multiple Y
    // dumb version of first dimension and first metric 
    let metric = "";
    for (const key in json[0]) {
        if (!state.keys.includes(key)) {
            metric = key;
        }
    }

    return {
        "d": state.keys[0],
        "m": metric
    };
};

const buildRequest = (state) => {
    // switch between different arch mode
    if (state.arch) {
        archMode = parseInt(state.arch);
    }

    // URL decoding the string and json object parsing
    const q = new NebulaClient.QueryRequest();
    q.setTable(state.table);
    q.setStart(seconds(state.start));
    q.setEnd(seconds(state.end));

    // the filter can be much more complex
    const filter = state.filter;
    if (filter) {
        // all rules under this group
        const rules = filter.r;
        if (rules && rules.length > 0) {
            const predicates = [];
            $.each(rules, (i, r) => {
                const pred = new NebulaClient.Predicate();
                if (r.v && r.v.length > 0) {
                    pred.setColumn(r.c);
                    pred.setOp(r.o);
                    pred.setValueList(r.v);
                    predicates.push(pred);
                }
            });


            if (predicates.length > 0) {
                if (filter.l === "AND") {
                    const f = new NebulaClient.PredicateAnd();
                    f.setExpressionList(predicates);
                    q.setFiltera(f);
                } else if (filter.l === "OR") {
                    const f = new NebulaClient.PredicateOr();
                    f.setExpressionList(predicates);
                    q.setFiltero(f);
                }
            }
        }
    }

    // set dimension
    const SAMPLES = NebulaClient.DisplayType.SAMPLES;
    const display = +state.display;
    const keys = state.keys;
    if (display == SAMPLES) {
        keys.unshift(timeCol);
    }
    q.setDimensionList(keys);


    // set query type and window
    q.setDisplay(state.display);
    q.setWindow(state.window);

    // set metric for non-samples query 
    // (use implicit type convert != instead of !==)
    if (display != SAMPLES) {
        const m = new NebulaClient.Metric();
        const mcol = state.metrics;
        m.setColumn(mcol);
        m.setMethod(state.rollup);
        q.setMetricList([m]);

        // set order on metric only means we don't order on samples for now
        const o = new NebulaClient.Order();
        o.setColumn(mcol);
        o.setType(state.sort);
        q.setOrder(o);
    }

    // set limit
    q.setTop(state.limit);

    return q;
};

const onQueryResult = (state, r) => {
    if (r.error) {
        msg(`[query: error=${r.error}, latency=${r.duration} ms]`);
        return;
    }

    msg(`[query time: ${r.duration} ms]`);

    // JSON result
    json = JSON.parse(NebulaClient.bytes2utf8(r.data));
    // newdata = true;

    // clear table data
    ds('#table_head').html("");
    ds('#table_content').html("");

    // get display option
    if (json.length == 0) {
        // TODO(cao): popuate scanned rows metric: rows: ${stats.getRowsscanned()}
        $('#show').html("<b>NO RESULTS.</b>");
        return;
    }

    const draw = () => {
        // enum value are number and switch/case are strong typed match
        const display = +state.display;
        const keys = extractXY(json, state);
        switch (display) {
            case NebulaClient.DisplayType.SAMPLES:
            case NebulaClient.DisplayType.TABLE:
                charts.displayTable(json);
                break;
            case NebulaClient.DisplayType.TIMELINE:
                const WINDOW_KEY = '_window_';
                const start = new Date(state.start);
                let data = {
                    default: json
                };
                // with dimension
                if (keys.d && keys.d.length > 0) {
                    const groupBy = (list, key) => {
                        return list.reduce((rv, x) => {
                            (rv[x[key]] = rv[x[key]] || []).push(x);
                            return rv;
                        }, {});
                    };

                    data = groupBy(json, keys.d);
                }

                charts.displayTimeline(data, WINDOW_KEY, keys.m, +start);
                break;
            case NebulaClient.DisplayType.BAR:
                charts.displayBar(json, keys.d, keys.m);
                break;
            case NebulaClient.DisplayType.PIE:
                charts.displayPie(json, keys.d, keys.m);
                break;
            case NebulaClient.DisplayType.LINE:
                charts.displayLine(json, keys.d, keys.m);
                break;
            case NebulaClient.DisplayType.FLAME:
                charts.displayFlame(json, keys.d, keys.m);
        }
    };

    // draw and redraw on window resize
    draw();
    $(window).on("resize", draw);
};

const execute = () => {
    // get parameters from URL
    const h = hash();
    if (!h || h.length <= 2) {
        return;
    }

    // build the request object
    const queryStr = h.substr(1);
    const state = JSON.parse(decodeURIComponent(queryStr));
    if (checkRequest(state)) {
        return;
    }

    // display message indicating processing
    msg("soaring in nebula to land...");

    const q = buildRequest(state);

    if (archMode === 1) {
        v1Client.query(q, {}, (err, reply) => {
            if (reply == null || err) {
                msg(`Failed to get reply: ${err}`);
                return;
            }

            const stats = reply.getStats();
            const r = {
                error: stats.getError(),
                duration: stats.getQuerytimems(),
                data: reply.getData()
            };

            // display data
            onQueryResult(state, r);
        });
    } else if (archMode === 2) {
        $.ajax({
            url: "/?api=query&start=0&end=0&query=" + queryStr
        }).fail((err) => {
            msg(`Error: ${err}`);
        }).done((data) => {
            onQueryResult(state, data);
        });
    }
};

ds('#soar').on("click", build);

/** switch user interface between UI elemments and coding editor */
const editor = CodeMirror.fromTextArea($("#code").get(0), {
    lineNumbers: false,
    lineWrapping: true,
    styleActiveLine: true,
    matchBrackets: true,
    mode: "javascript",
    theme: "dracula"
});

const ide = () => {
    const c_on = "tap-on";
    const c_off = "tap-off";
    const on = $(`.${c_on}`);
    const off = $(`.${c_off}`);
    on.removeClass(c_on).addClass(c_off);
    off.removeClass(c_off).addClass(c_on);

    // refresh editor to get focus
    setTimeout(() => editor.refresh(), 5);
};

ds('#ui').on("click", ide);


/** execute the code written by user */
const exec = () => {
    // evaluate the code in the editor
    // build nebula object out of it
    // translate it into a service call with build
    // call service to get results back
    const code = editor.getValue();

    // reset the nebula context object and call eval
    nebula.reset();

    // try to eval user's code
    try {
        eval(code);
    } catch (e) {
        msg(`Code Error: ${e.message}`);
        return;
    }

    // based on the code, let's build a model from it
    const error = nebula.validate();
    if (error) {
        msg(`Validation Error: ${error}`);
        return;
    }

    // convert the SDK data into a web request object
    const state = nebula.build();

    // append the source code to this query state
    state.code = code;

    // build this state as a query
    build(state);
};
ds('#exec').on("click", exec);
// $("#sdw").hide();

// hook up hash change event
window.onhashchange = function () {
    execute();
};

// load table list - maximum 100?
const onTableList = (tables) => {
    const options = ds('#tables').selectAll("option").data(tables.sort()).enter().append('option');
    options.text(d => d).attr("value", d => d);
    // restore the selection
    restore();
};
$(() => {
    const stats = ds('#stats');
    if (archMode === 1) {
        const listReq = new NebulaClient.ListTables();
        listReq.setLimit(100);
        v1Client.tables(listReq, {}, (err, reply) => {
            if (err !== null) {
                stats.text(`RPC Error: ${err}`);
                return;
            }

            onTableList(reply.getTableList());
        });
    } else if (archMode === 2) {
        $.ajax({
            url: "/?api=tables&start=0&end=0"
        }).fail((err) => {
            stats.text("Error: " + err);
        }).done((data) => {
            onTableList(data);
        });
    }

    // if user change the table selection, initialize it again
    ds('#tables').on('change', () => {
        hash('n');
        restore();
    });

    // display current user info if available
    $.ajax({
        url: "/?api=user"
    }).done((data) => {
        ds('#user').text(data.auth ? data.user : "unauth");
    });

    // Remove Sandance for now. 
    // set sundance to load after all page inits so it doesn't block current page loading
    // ds('#sandance').attr("src", "d/sde.html");
});

/** Remove Sandance from nebula for now
const vis = async (r) => {
    // n=>nebula, s=>sanddance
    const choice = r.target.value;
    if (choice == 'n') {
        $("#show").show();
        $("#sdw").hide();
    } else if (choice == 's') {
        $("#show").hide();
        $("#sdw").show();

        // go with sanddance
        if (newdata) {
            if (json && json.length > 0) {
                const sandance = () => {
                    // TODO(cao): to use content window we have to use document.getElementById, not sure why
                    const s = document.getElementById("sandance");
                    const _post = m => s.contentWindow.postMessage(m, '*');
                    return new Promise(resolve => {
                        resolve(_post);
                    });
                };

                // display an embeded explorer
                (await sandance())(json);
            }
            newdata = false;
        }
    }
};

$("#vn").on("click", vis);
$("#vs").on("click", vis);
 */