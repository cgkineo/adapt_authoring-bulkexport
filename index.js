const archive = require('archiver')('zip');
const async = require('async');
const { Constants } = require('../../lib/outputmanager');
const express = require('express');
const fs = require('fs-extra');
const mongoose = require('mongoose');
const origin = require('../../lib/application')();
const path = require('path');
const permissions = require('../../lib/permissions');
const server = module.exports = express();

const courseexports = loadMetadata()
let adapt, course;

/** @todo should be in the DB **/
function loadMetadata() {
  try { return require('../../exports.json'); }
  catch(e) { return { exports: {}, courses: {} }; }
}
function saveMetadata() {
  try { fs.writeJsonSync('./exports.json', courseexports, { spaces: 2 }); }
  catch(e) { console.log(e); }
}

function init() {
  origin.outputmanager.getOutputPlugin('adapt', (error, plugin) => {
    if (error) return console.log(error);
    adapt = plugin;
  });
  origin.contentmanager.getContentPlugin('course', (error, plugin) => {
    if (error) return console.log(error);
    course = plugin;
  });
  const r = express.Router();
  // routes
  r.use(checkPermissions);
  r.get('/', renderIndex);
  r.post('/', bulkExport);
  r.get('/download/:id', sendExports);
  r.get('/poll/:id', pollExportProgress);

  server.set('views', __dirname);
  server.set('view engine', 'hbs');
  server.use('/bulkexport', r);
}

function checkPermissions(req, res, next) {
  if(!req.user) {
    return res.status(401).send('Unauthorised');
  }
  permissions.hasPermission(req.user._id, '*', '*', isAllowed => {
    if(!isAllowed) {
      return res.status(403).send('Forbidden');
    }
    next();
  });
}

function renderIndex(req, res, next) {
  course.retrieve({ _isDeleted: false }, {}, (error, courses) => {
    if(error) return next(error);
    res.render(path.join(__dirname, 'views', 'index'), { courses: mapCourseData(courses) });
  });
}

function bulkExport(req, res, next) {
  if(!req.body.courses) {
    return next('Must provide courses to export!');
  }
  const exportsRoot = path.join(origin.configuration.tempDir, origin.configuration.getConfig('masterTenantID'), Constants.Folders.Exports, normalisePath(`Export ${new Date().toISOString()}`));
  const id = new Date().getTime();

  courseexports.exports[id] = {
    timestamp: new Date(id),
    courses: req.body.courses,
    dir: exportsRoot,
    completed: 0,
    total: req.body.courses.length, errors: []
  };
  saveMetadata();
  req.params.id = id;
  pollExportProgress(req, res, next);

  fs.ensureDirSync(exportsRoot);

  async.eachSeries(req.body.courses, (courseId, cb) => {
    const handleError = (error) => {
      console.log(error);
      courseexports.exports[id].errors.push({ courseId: courseId, error: error.toString() });
      saveMetadata();
      cb();
    };
    course.retrieve({ _id: courseId }, {}, (error, results) => {
      if(error) {
        return handleError(error);
      }
      if(!results.length) {
        return handleError(new Error(`No course with _id '${courseId}'`));
      }
      adapt.export(courseId, { outputdir: path.join(exportsRoot, normalisePath(results[0].title)) }, error => {
        if(error) return handleError(error);

        courseexports.exports[id].completed++;
        courseexports.courses[courseId] = courseexports.exports[id].timestamp;
        saveMetadata();
        cb();
      });
    });
  });
}

function sendExports(req, res, next) {
  const data = courseexports.exports[req.params.id];
  if(!data) {
    return res.status(404).end();
  }
  zipExports(data.dir, (error, zipname) => res.sendFile(zipname));
}

function pollExportProgress(req, res, next) {
  const data = courseexports.exports[req.params.id];
  if(!data) {
    return res.status(404).end();
  }
  res.json({ id: req.params.id, completed: data.completed, total: data.total, errors: data.errors });
}

function zipExports(dir, cb) {
  const zipname = `${dir}.zip`;
  
  if(fs.existsSync(zipname)) {
    return cb(null, zipname);
  }
  const output = fs.createWriteStream(zipname);
  output.on('close', () => cb(null, zipname));
  archive.pipe(output);
  archive.glob('**/*', { cwd: path.join(dir) });
  archive.finalize();
}

function mapCourseData(results) {
  return results.map(r => {
    r.exportedAt = courseexports.courses[r._id];
    return {
      _id: r._id,
      title: r.title,
      updatedAt: toDateString(r.updatedAt),
      updatedTime: toTimeString(r.updatedAt),
      exportedAt: toDateString(r.exportedAt),
      exportedTime: toTimeString(r.exportedAt)
    };
  });
}

function toDateString(dateString) {
  if(!dateString) return '';
  return new Date(dateString).toDateString();
}

function toTimeString(dateString) {
  if(!dateString) return '';
  return new Date(dateString).getTime();
}

function normalisePath(p) {
  return p.replace(/\s|\//g, '-');
}

init();
