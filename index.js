const archive = require('archiver')('zip');
const async = require('async');
const { Constants } = require('../../lib/outputmanager');
const express = require('express');
const fs = require('fs-extra');
const origin = require('../../lib/application')();
const path = require('path');
const server = module.exports = express();

let adapt, course;

function init() {
  origin.outputmanager.getOutputPlugin('adapt', (error, plugin) => {
    if (error) return console.log(error);
    adapt = plugin;
  });
  origin.contentmanager.getContentPlugin('course', (error, plugin) => {
    if (error) return console.log(error);
    course = plugin;
    course.update({}, {}, (error, results) => {
    // course.update({ _id: "5ce3fc6ce9beec8458807b6a" }, { exportedAt: new Date() }, (error, results) => {
      console.log(error, results);
    });
  });

  server.set('views', __dirname);
  server.set('view engine', 'hbs');
  // routes
  server.get('/bulkexport', renderIndex);
  server.post('/bulkexport', bulkExport);

  const customSchema = {
    exportedAt: {
      type: "date",
      required: false,
      editorOnly: true
    }
  };
  origin.db.getModel('course').schema.add(customSchema);
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
  fs.ensureDirSync(exportsRoot);

  async.eachSeries(req.body.courses, (courseId, cb) => {
    course.retrieve({ _id: courseId }, {}, (error, results) => {
      if(error || !results.length) return cb(error);
      adapt.export(courseId, { outputdir: path.join(exportsRoot, results[0].title) }, error => {
        if(error) return cb(error);
        course.update({ _id: courseId }, { exportedAt: new Date() }, cb);
      });
    });
  }, error => {
    if(error) {
      return next(error);
    }
    const output = fs.createWriteStream(`${exportsRoot}.zip`);
    output.on('close', () => { fs.remove(exportsRoot); });
    archive.pipe(output);
    archive.glob('**/*', { cwd: path.join(exportsRoot) });
    archive.finalize();
    res.json({ export: `${exportsRoot}.zip` });
    // res.sendFile(`${exportsRoot}.zip`);
  });
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

/*
server.get('/export/:tenant/:course/download.zip', function (req, res, next) {
  var tenantId = req.params.tenant;
  var courseId = req.params.course;
  var userId = usermanager.getCurrentUser()._id;
  // TODO not good specifying this here AND in plugins/output/adapt/export EXPORT_DIR
  var zipDir = path.join(
    configuration.tempDir,
    configuration.getConfig('masterTenantID'),
    Constants.Folders.Exports,
    userId + '.zip'
  );
  // get the course name
  app.contentmanager.getContentPlugin('course', function (error, plugin) {
    if (error) return handleError(error, res);
    plugin.retrieve({ _id:courseId }, {}, function(error, results) {
      if (error) return handleError(error, res);
      if (results.length !== 1) {
        return handleError(new Error('Export: cannot find course (' + courseId + ')'), res);
      }
      fs.stat(zipDir, function(error, stat) {
        if (error) return handleError(error, res);
        var zipName = helpers.slugify(results[0].title,'export') + '.zip';
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': stat.size,
          'Content-disposition' : 'attachment; filename=' + zipName,
          'Pragma' : 'no-cache',
          'Expires' : '0'
        });
        fs.createReadStream(zipDir).pipe(res);
      });
    });
  });
});
*/
