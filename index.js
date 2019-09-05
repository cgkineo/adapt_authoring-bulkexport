const archive = require('archiver')('zip');
const async = require('async');
const { Constants } = require('../../lib/outputmanager');
const express = require('express');
const fs = require('fs-extra');
const mongoose = require('mongoose');
const origin = require('../../lib/application')();
const path = require('path');
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

  server.set('views', __dirname);
  server.set('view engine', 'hbs');
  // routes
  server.get('/bulkexport', renderIndex);
  server.post('/bulkexport', bulkExport);
  server.get('/bulkexport/download/:id', sendExports);
  server.get('/bulkexport/poll/:id', pollExportProgress);
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
  console.log('sendExports');
  const data = courseexports.exports[req.params.id];
  // if(!data) {
  //   return res.status(404).end();
  // }
  // console.log(data);
  const rootdir = path.join(origin.configuration.tempDir, origin.configuration.getConfig('masterTenantID'), Constants.Folders.Exports, 'Export-2019-09-04T19.56.46.453Z');
  const filename = 'DO-NOT-EDIT-m190-Step-1.-Define-the-problem.zip';
  res.sendFile(filename, { root: rootdir }, error => {
    if(error) {
      console.log(error);
      next(error);
    }
    console.log('success', rootdir, filename);
  });
}

function pollExportProgress(req, res, next) {
  const data = courseexports.exports[req.params.id];
  if(!data) {
    return res.status(404).end();
  }
  res.json({ id: req.params.id, completed: data.completed, total: data.total, errors: data.errors });
}

function zipExports(dir) {
  const output = fs.createWriteStream(`${dir}.zip`);
  output.on('close', () => { fs.remove(dir); });
  archive.pipe(output);
  archive.glob('**/*', { cwd: path.join(dir) });
  archive.finalize();
}

function mapCourseData(results) {
  return results.map(r => {
    Object.values(courseexports.exports).forEach(e => {
      if(e.courses.includes(r._id.toString())) r.exportedAt = e.timestamp;
    });
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
