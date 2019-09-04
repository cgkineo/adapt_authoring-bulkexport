const archive = require('archiver')('zip');
const async = require('async');
const { Constants } = require('../../lib/outputmanager');
const express = require('express');
const fs = require('fs-extra');
const origin = require('../../lib/application')();
const path = require('path');
const server = module.exports = express();
/** @todo should be in the DB **/
const currentExports = {};

let adapt, course;

function init() {
  origin.outputmanager.getOutputPlugin('adapt', (error, plugin) => {
    if (error) return console.log(error);
    adapt = plugin;
  });
  origin.contentmanager.getContentPlugin('course', (error, plugin) => {
    if (error) return console.log(error);
    course = plugin;
  });

  origin.db.addModel('courseexport', { courseId: 'objectid', time: 'date' });

  server.set('views', __dirname);
  server.set('view engine', 'hbs');
  // routes
  server.get('/bulkexport', renderIndex);
  server.post('/bulkexport', bulkExport);
  server.get('/bulkexport/download/:id', sendExports);
  server.get('/bulkexport/poll/:id', pollExportProgress);
}

function renderIndex(req, res, next) {
  course.retrieve({ _isDeleted: false }, {}, (error, results) => {
    if(error) return next(error);
    res.render(path.join(__dirname, 'views', 'index'), { courses: mapCourseData(results) });
  });
}

function bulkExport(req, res, next) {
  if(!req.body.courses) {
    return next('Must provide courses to export!');
  }
  const exportsRoot = path.join(origin.configuration.tempDir, origin.configuration.getConfig('masterTenantID'), Constants.Folders.Exports, `Export ${new Date().toISOString()}`);
  const id = new Date().getTime();

  currentExports[id] = {
    dir: exportsRoot,
    completed: 0,
    total: req.body.courses.length, errors: []
  };
  req.params.id = id;
  pollExportProgress(req, res, next);

  fs.ensureDirSync(exportsRoot);

  async.eachSeries(req.body.courses, (courseId, cb) => {
    const handleError = (error) => {
      console.log(error);
      currentExports[id].errors.push({ courseId, error });
      cb();
    };
    course.retrieve({ _id: courseId }, {}, (error, results) => {
      if(error) {
        return handleError(error);
      }
      if(!results.length) {
        return handleError(new Error(`No course with _id '${courseId}'`));
      }
      adapt.export(courseId, { outputdir: path.join(exportsRoot, results[0].title) }, error => {
        if(error) return handleError(error);

        origin.db.create('courseexport', { courseId: courseId, time: new Date() }, error => {
          if(error) return handleError(error);

          currentExports[id].completed++;
          cb();
        });
      });
    });
  });
}

function sendExports(req, res, next) {
  const data = currentExports[req.params.id];
  if(!data) {
    return res.status(404).end();
  }
  console.log(data);
  // res.sendFile(fileName, options, error => { if(error) next(error); });
}

function pollExportProgress(req, res, next) {
  const data = currentExports[req.params.id];
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

init();
