import React, { Component } from 'react';

var DESCRIPTION_KEYS = [
  'description1',
  'description2',
  'description3',
  'description4',
  'description5',
  'description6'
];

// Collect description1..N into a list, stripping the leading "• "
function bullets(item) {
  var out = [];
  for (var i = 0; i < DESCRIPTION_KEYS.length; i++) {
    var d = item[DESCRIPTION_KEYS[i]];
    if (d) out.push(d.replace(/^\s*•\s*/, ''));
  }
  return out;
}

class Resume extends Component {
  render() {
    var education = null;
    var work = null;
    var project = null;

    if (this.props.data) {
      education = this.props.data.education.map(function(item) {
        var points = bullets(item).map(function(point, i) {
          return <li key={i}>{point}</li>;
        });
        return (
          <div className="glass-card edu-card reveal" key={item.school}>
            <div className="card-head">
              <h3>{item.school}</h3>
              <span className="date-pill">{item.graduated}</span>
            </div>
            <p className="role-line">{item.degree}</p>
            <ul className="points">{points}</ul>
          </div>
        );
      });

      work = this.props.data.work.map(function(item, index) {
        var points = bullets(item).map(function(point, i) {
          return <li key={i}>{point}</li>;
        });
        var tags = null;
        if (item.tags) {
          tags = (
            <div className="tag-row">
              {item.tags.map(function(tag) {
                return (
                  <span className="tech-pill" key={tag}>
                    {tag}
                  </span>
                );
              })}
            </div>
          );
        }
        return (
          <div
            className="timeline-item reveal"
            key={item.company}
            style={{ transitionDelay: (index % 3) * 80 + 'ms' }}
          >
            <span className="timeline-dot"></span>
            <div className="glass-card work-card">
              <div className="card-head">
                <h3>{item.company}</h3>
                <span className="date-pill">{item.years}</span>
              </div>
              <p className="role-line">
                {item.title}
                {item.location ? (
                  <span className="loc"> · {item.location}</span>
                ) : null}
              </p>
              <ul className="points">{points}</ul>
              {tags}
            </div>
          </div>
        );
      });

      project = this.props.data.project.map(function(item, index) {
        var points = bullets(item).map(function(point, i) {
          return <li key={i}>{point}</li>;
        });
        var stack = null;
        if (item.title) {
          stack = (
            <div className="tag-row">
              {item.title.split('|').map(function(tag) {
                return (
                  <span className="tech-pill" key={tag}>
                    {tag.trim()}
                  </span>
                );
              })}
            </div>
          );
        }
        return (
          <div
            className="glass-card project-card reveal"
            key={item.company}
            style={{ transitionDelay: (index % 2) * 80 + 'ms' }}
          >
            <h3>{item.company}</h3>
            <ul className="points">{points}</ul>
            {stack}
          </div>
        );
      });
    }

    return (
      <section id="resume">
        <div className="row section-block work">
          <div className="section-head reveal">
            <h1>
              <span>Experience</span>
            </h1>
          </div>
          <div className="timeline">{work}</div>
        </div>

        <div className="row section-block education">
          <div className="section-head reveal">
            <h1>
              <span>Education</span>
            </h1>
          </div>
          <div className="edu-wrap">{education}</div>
        </div>

        <div className="row section-block projects">
          <div className="section-head reveal">
            <h1>
              <span>Projects</span>
            </h1>
          </div>
          <div className="project-grid">{project}</div>
        </div>
      </section>
    );
  }
}

export default Resume;
